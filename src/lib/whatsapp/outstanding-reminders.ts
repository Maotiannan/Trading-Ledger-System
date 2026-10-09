import { isDeepStrictEqual } from 'node:util';
import { Prisma, type WhatsAppDelivery } from '@prisma/client';
import { db } from '@/lib/db';
import type { DbTransactionClient } from '@/lib/transaction';
import { buildDashboardOutstandingSnapshot, dashboardOutstandingInvoiceSelect } from '@/lib/dashboard-customer-outstanding';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { evaluateOutstandingReminder, OUTSTANDING_REMINDER_POLICY, type ReminderHistory } from './outstanding-reminder-policy';
import { getWhatsAppSettings, parseWhatsAppSettings, WHATSAPP_SETTINGS_KEY } from './whatsapp-settings';
import { runWhatsAppTransaction } from './whatsapp-transaction';
import { listWhatsAppTemplateVersions } from './whatsapp-template-service';
import type { TemplateVersion } from './whatsapp-template-definition';
import { normalizeWhatsAppCustomerPhone } from './customer-phone';
import { bufferDeadline, pendingDeliveryUpdate } from './whatsapp-buffer';
import { enqueueWhatsAppInTransaction } from './whatsapp-queue';
import { failedRetryAncestors } from './whatsapp-retry-policy';

const TYPE = 'OUTSTANDING_REMINDER' as const;
const editable = ['PENDING', 'QUEUED', 'PAUSED', 'SENDING', 'UNCERTAIN'] as const;

async function resolveReminder(tx: DbTransactionClient, customerId: string, testMode: boolean, now: Date, excludeId?: string, ancestors: WhatsAppDelivery[] = []) {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  const invoices = await tx.invoice.findMany({ where: { orders: { some: { customerId } } }, select: dashboardOutstandingInvoiceSelect({ customerId }) });
  const outstanding = buildDashboardOutstandingSnapshot(invoices, now.getTime()).customerOutstanding.find(item => item.customerId === customerId);
  const episodeKey = `whatsapp.reminder.episode.${customerId}.${testMode ? 'test' : 'live'}`;
  if (!outstanding?.orders.some(order => order.statusGroup === 'RELEASED' && order.outstanding > OUTSTANDING_REMINDER_POLICY.minimumBalance)) {
    await tx.systemSetting.upsert({ where: { key: episodeKey }, create: { key: episodeKey, value: now.toISOString() }, update: { value: now.toISOString() } });
    return null;
  }
  const episode = await tx.systemSetting.findUnique({ where: { key: episodeKey } });
  const clearedAt = episode && Number.isFinite(Date.parse(episode.value)) ? new Date(episode.value) : null;
  const previous = await tx.whatsAppDelivery.findFirst({
    where: { type: TYPE, testMode, contact: { customerId }, ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}), ...(excludeId ? { id: { notIn: [excludeId, ...ancestors.map(row => row.id)] } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (previous && editable.some(status => status === previous.status)) return null;
  // A newer independent reminder supersedes this failed chain, even if it failed.
  const root = ancestors.at(-1);
  if (root && previous && previous.createdAt >= root.createdAt) return null;
  const old = previous?.businessSnapshot as Record<string, unknown> | undefined;
  const history: ReminderHistory | null = previous && typeof old?.anchorId === 'string' && typeof old?.stage === 'number'
    ? { anchorId: old.anchorId, stage: old.stage, sentAt: previous.claimedAt || previous.createdAt } : null;
  const decision = evaluateOutstandingReminder({ orders: outstanding.orders, history, now, checkSchedule: !excludeId });
  if (!decision) return null;
  const receipts = await tx.receipt.findMany({ where: { order: { customerId } }, select: { id: true, detailItems: { select: { detailId: true } } } });
  const paused = Boolean(await tx.deletionRequest.findFirst({ where: { status: 'PENDING', OR: [
    { targetType: 'RECEIPT', targetId: { in: receipts.map(row => row.id) } },
    { targetType: 'DETAIL', targetId: { in: receipts.flatMap(row => row.detailItems.map(item => item.detailId)) } },
  ] }, select: { id: true } }));
  return { customer, paused, decision, snapshot: {
    customerId, customerName: formatCustomerPayerLabel(customer), language: 'FRENCH',
    anchorId: decision.anchor.orderId, stage: decision.stage, oldestOrder: decision.anchor.orderNo,
    age: decision.age, statementDate: now.toISOString().slice(0, 10), outstanding,
  } };
}

function renderReminder(live: NonNullable<Awaited<ReturnType<typeof resolveReminder>>>, templates: TemplateVersion[], testMode: boolean) {
  const template = templates.find(item => item.kind === `outstanding${live.decision.stage}` && item.language === 'fr'
    && item.active && item.status === 'APPROVED' && item.category === 'UTILITY');
  if (!template) return null;
  const overdue = live.snapshot.outstanding.orders.filter(order => order.statusGroup === 'RELEASED'
    && order.outstanding > OUTSTANDING_REMINDER_POLICY.minimumBalance && (order.daysSinceRelease ?? 0) >= 30).reduce((sum, order) => sum + order.outstanding, 0);
  const parameters = [live.snapshot.customerName || live.customer.mark || live.customer.id, Math.round(overdue).toLocaleString('en-US'), live.decision.anchor.orderNo, String(live.decision.age)]
    .map(value => value.replace(/[\r\n\t]+/g, ' ').trim());
  if (parameters.some(value => !value || value.length > 1024)) return null;
  return { templateName: template.name, languageCode: 'fr', parameters, testMode };
}

export async function refreshOutstandingReminder(tx: DbTransactionClient, delivery: WhatsAppDelivery, templates: TemplateVersion[]) {
  const row = await tx.systemSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
  const settings = parseWhatsAppSettings(row ? JSON.parse(row.value) : {});
  const where = { id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt, claimToken: null };
  const snapshot = delivery.businessSnapshot as Record<string, unknown>;
  const customerId = typeof snapshot.customerId === 'string' ? snapshot.customerId : '';
  const ancestors = delivery.retryOf ? await failedRetryAncestors(tx, delivery) : [];
  const live = ancestors && (settings.reminderEnabled || Boolean(delivery.retryOf)) && delivery.testMode === settings.reminderTestMode
    ? await resolveReminder(tx, customerId, delivery.testMode, new Date(), delivery.id, ancestors) : null;
  const contact = live ? await tx.customerWhatsAppContact.findFirst({
    where: { customerId, optedInAt: { not: null }, optedOutAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  }) : null;
  if (!live || !contact) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'CANCELLED', failureCode: 'REMINDER_NO_LONGER_ELIGIBLE' } });
    return null;
  }
  const rendered = renderReminder(live, templates, delivery.testMode);
  const intendedTo = normalizeWhatsAppCustomerPhone(live.customer.phone);
  if (!rendered || !intendedTo) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'PAUSED', failureCode: !rendered ? 'REMINDER_TEMPLATE_REQUIRED' : 'INVALID_CUSTOMER_PHONE', approvedAt: null, approvedBy: null } });
    return null;
  }
  const actualTo = delivery.testMode ? settings.testDestination : intendedTo;
  const changed = !isDeepStrictEqual(live.snapshot, delivery.businessSnapshot)
    || !isDeepStrictEqual(rendered.parameters, delivery.parameters) || rendered.templateName !== delivery.templateName
    || contact.id !== delivery.contactId || intendedTo !== delivery.intendedTo || actualTo !== delivery.actualTo;
  const state = pendingDeliveryUpdate({ paused: live.paused, wasPaused: delivery.status === 'PAUSED', changed, requiresApproval: delivery.testMode });
  if (!changed && !Object.keys(state).length) return delivery;
  const result = await tx.whatsAppDelivery.updateMany({ where, data: { ...state, ...rendered, contactId: contact.id, intendedTo, actualTo,
    businessSnapshot: live.snapshot as unknown as Prisma.InputJsonObject } });
  return result.count === 1 ? tx.whatsAppDelivery.findUnique({ where: { id: delivery.id } }) : null;
}

export async function projectOutstandingReminders(now = new Date()) {
  const settings = await getWhatsAppSettings();
  const senderPhone = process.env.YCLOUD_SENDER_PHONE;
  if (!settings.outboundEnabled || !settings.reminderEnabled || !senderPhone || now.getUTCHours() < 7) return;
  const dayKey = `whatsapp.reminder.scan.${settings.reminderTestMode ? 'test' : 'live'}`;
  const today = now.toISOString().slice(0, 10);
  const scan = await db.systemSetting.findUnique({ where: { key: dayKey } });
  if (scan?.value === today) return;
  const templates = await listWhatsAppTemplateVersions();
  const contacts = await db.customerWhatsAppContact.findMany({ where: { optedInAt: { not: null }, optedOutAt: null }, select: { customerId: true } });
  for (const customerId of new Set(contacts.map(contact => contact.customerId))) {
    await runWhatsAppTransaction(async tx => {
      // Lock an existing row before reads; no financial/customer fields are changed.
      await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${customerId} FOR UPDATE`;
      const live = await resolveReminder(tx, customerId, settings.reminderTestMode, now);
      if (!live) return;
      const rendered = renderReminder(live, templates, settings.reminderTestMode);
      if (!rendered) return;
      const contact = await tx.customerWhatsAppContact.findFirst({ where: { customerId, optedInAt: { not: null }, optedOutAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
      if (!contact) return;
      const eventKey = `outstanding:${customerId}:${settings.reminderTestMode ? 'test' : 'live'}:${today}`;
      const result = await enqueueWhatsAppInTransaction(tx, { eventKey, sourceId: eventKey, type: TYPE,
        contactId: contact.id, ...rendered, senderPhone, testDestination: settings.testDestination,
        businessSnapshot: live.snapshot as unknown as Prisma.InputJsonObject });
      if ('delivery' in result && result.delivery && live.paused) {
        await tx.whatsAppDelivery.updateMany({ where: { id: result.delivery.id, claimToken: null }, data: {
          status: 'PAUSED', failureCode: 'DELETION_PENDING', nextSendAt: bufferDeadline(now),
        } });
      }
    });
  }
  await db.systemSetting.upsert({ where: { key: dayKey }, create: { key: dayKey, value: today }, update: { value: today } });
}
