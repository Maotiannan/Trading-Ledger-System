import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type WhatsAppDelivery } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { db } from '@/lib/db';
import { computeOrderBalanceFromReceipts } from '@/lib/order-balance';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { bufferDeadline } from './whatsapp-buffer';
import { resolveWhatsAppSource } from './whatsapp-live-source';
import { renderWhatsAppSnapshot } from './whatsapp-template';
import { normalizeWhatsAppCustomerPhone } from './customer-phone';
import { runWhatsAppTransaction } from './whatsapp-transaction';
import type { TemplateVersion } from './whatsapp-template-definition';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const submitted = ['ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'UNCERTAIN'] as const;
type Changed = { row: WhatsAppDelivery; signature: string; baselineId: string | null; removed: boolean };

async function changedOriginal(tx: DbTransactionClient, row: WhatsAppDelivery, templates: TemplateVersion[]) {
  const source = await tx.emailNotification.findUnique({ where: { id: row.sourceId } });
  const live = source ? await resolveWhatsAppSource(tx, source) : null;
  if (live?.paused) return null;
  const rendered = live ? renderWhatsAppSnapshot(row.type, live.snapshot, templates) : null;
  const signature = digest([row.id, rendered?.parameters || 'SOURCE_REMOVED']);
  const latest = await tx.whatsAppDelivery.findFirst({ where: { correctionOf: { array_contains: [row.id] }, status: { in: [...submitted] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const previous = latest?.businessSnapshot as Record<string, unknown> | undefined;
  const baseline = Array.isArray(previous?.correctedSources)
    ? previous.correctedSources.find((item: { id?: string }) => item?.id === row.id) as { signature?: string } | undefined : undefined;
  // Do not generate retrospective corrections for old balance-format changes.
  // Eligibility begins with buffered deliveries created by this release.
  if (baseline ? baseline.signature === signature : live && isDeepStrictEqual(row.parameters, rendered?.parameters)) return null;
  return { row, removed: !live, signature, baselineId: latest?.id || null };
}

export async function refreshCorrectionInTransaction(tx: DbTransactionClient, delivery: WhatsAppDelivery, templates: TemplateVersion[]) {
  const ids = Array.isArray(delivery.correctionOf) ? delivery.correctionOf.filter((id): id is string => typeof id === 'string') : [];
  if (!ids.length) return null;
  const originals = await tx.whatsAppDelivery.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
  const snapshot = delivery.businessSnapshot as Record<string, unknown>;
  const orderId = typeof snapshot.orderId === 'string' ? snapshot.orderId : '';
  const customerId = typeof snapshot.customerId === 'string' ? snapshot.customerId : '';
  const order = await tx.order.findFirst({ where: { id: orderId, customerId }, include: { receipts: true, invoice: true, customer: true } });
  const contact = await tx.customerWhatsAppContact.findFirst({ where: { customerId, optedInAt: { not: null }, optedOutAt: null }, orderBy: { updatedAt: 'desc' } });
  const where = { id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt, claimToken: null };
  if (!order?.customer || !contact) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'CANCELLED', failureCode: 'SOURCE_OR_CONSENT_REMOVED' } });
    return null;
  }
  const changes: Changed[] = [];
  for (const row of originals) {
    const source = await tx.emailNotification.findUnique({ where: { id: row.sourceId } });
    const live = source ? await resolveWhatsAppSource(tx, source) : null;
    if (live?.paused) {
      await tx.whatsAppDelivery.updateMany({ where, data: { status: 'PAUSED', failureCode: 'DELETION_PENDING', approvedBy: null, approvedAt: null } });
      return null;
    }
    const change = await changedOriginal(tx, row, templates);
    if (change) changes.push(change);
  }
  if (!changes.length) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'CANCELLED', failureCode: 'CORRECTION_NO_LONGER_NEEDED' } });
    return null;
  }
  const customer = order.customer;
  const intendedTo = normalizeWhatsAppCustomerPhone(customer.phone);
  if (!intendedTo) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'PAUSED', failureCode: 'INVALID_CUSTOMER_PHONE', approvedBy: null, approvedAt: null } });
    return null;
  }
  const currentSnapshot = { customerId, orderId, customerName: formatCustomerPayerLabel(customer), language: customer.notificationLanguage,
    orderNos: [order.orderNo], invoiceNo: order.invoice.invNo, orderBalance: computeOrderBalanceFromReceipts(order),
    receiptNo: [...new Set(changes.map(change => String((change.row.businessSnapshot as Record<string, unknown>).receiptNo || '-')))].join(', '),
    correctionReason: changes.some(change => change.removed) ? 'RECEIPT_REMOVED' : 'RECORD_CHANGED',
    correctedSources: changes.map(change => ({ id: change.row.id, signature: change.signature })),
    cancelledReceipts: changes.filter(change => change.removed).map(change => {
      const old = change.row.businessSnapshot as Record<string, unknown>;
      return `${old.receiptNo || '-'} (USD ${Math.round(Number(old.amount || 0)).toLocaleString('en-US')})`;
    }).join(', '),
  };
  const rendered = renderWhatsAppSnapshot('CORRECTION', currentSnapshot, templates);
  const actualTo = delivery.testMode ? delivery.actualTo : intendedTo;
  const changed = !isDeepStrictEqual(currentSnapshot, delivery.businessSnapshot) || !isDeepStrictEqual(rendered.parameters, delivery.parameters)
    || actualTo !== delivery.actualTo || intendedTo !== delivery.intendedTo || contact.id !== delivery.contactId
    || rendered.templateName !== delivery.templateName || rendered.languageCode !== delivery.languageCode;
  if (!changed && delivery.status !== 'PAUSED') return delivery;
  await tx.whatsAppDelivery.updateMany({ where, data: { businessSnapshot: currentSnapshot, parameters: rendered.parameters,
    templateName: rendered.templateName, languageCode: rendered.languageCode, intendedTo, actualTo, contactId: contact.id,
    status: 'PENDING', requiresApproval: true, approvedBy: null, approvedAt: null, nextSendAt: bufferDeadline(), failureCode: null } });
  return tx.whatsAppDelivery.findUnique({ where: { id: delivery.id } });
}

export async function projectWhatsAppCorrections(templates: TemplateVersion[]) {
  let cursor: string | undefined;
  const groups = new Map<string, Changed[]>();
  do {
    const rows = await db.whatsAppDelivery.findMany({ where: { status: { in: [...submitted] }, type: 'PAYMENT_RECEIVED',
      correctionOf: { equals: Prisma.DbNull }, nextSendAt: { not: null } }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const row of rows) {
      const snapshot = row.businessSnapshot as Record<string, unknown>;
      if (!snapshot.orderId || !snapshot.customerId) continue;
      const change = await runWhatsAppTransaction(tx => changedOriginal(tx, row, templates));
      if (!change) continue;
      const key = `correction:${row.testMode ? row.actualTo : 'live'}:${snapshot.customerId}:${snapshot.orderId}`;
      groups.set(key, [...(groups.get(key) || []), change]);
    }
    cursor = rows.length === 100 ? rows[rows.length - 1].id : undefined;
  } while (cursor);
  for (const [sourceId, changes] of groups) {
    const eventKey = 'correction:' + digest(changes.map(change => [change.signature, change.baselineId]));
    await runWhatsAppTransaction(async tx => {
      if (await tx.whatsAppDelivery.findUnique({ where: { eventKey } })) return;
      const active = await tx.whatsAppDelivery.findFirst({ where: { sourceId, status: { in: ['PENDING', 'QUEUED', 'PAUSED'] } } });
      const first = changes[0].row;
      const correctionOf = changes.map(change => change.row.id);
      const delivery = active
        ? await tx.whatsAppDelivery.update({ where: { id: active.id }, data: { eventKey, correctionOf, status: 'PENDING', approvedAt: null, approvedBy: null, nextSendAt: bufferDeadline() } })
        : await tx.whatsAppDelivery.create({ data: { eventKey, sourceId, correctionOf, contactId: first.contactId, type: 'PAYMENT_RECEIVED',
          testMode: first.testMode, intendedTo: first.intendedTo, actualTo: first.actualTo, senderPhone: first.senderPhone,
          templateName: 'muledger_correction_v1', languageCode: first.languageCode, parameters: [], businessSnapshot: first.businessSnapshot as Prisma.InputJsonObject,
          requiresApproval: true, status: 'PENDING', nextSendAt: bufferDeadline() } });
      await refreshCorrectionInTransaction(tx, delivery, templates);
    });
  }
}
