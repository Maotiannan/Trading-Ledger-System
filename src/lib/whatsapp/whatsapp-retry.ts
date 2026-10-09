import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { bufferDeadline } from './whatsapp-buffer';
import { failedRetryAncestors, isExplicitWhatsAppFailure, verifyFailedWhatsAppProvider } from './whatsapp-retry-policy';
import { listWhatsAppTemplateVersions } from './whatsapp-template-service';
import { refreshWhatsAppInTransaction } from './whatsapp-refresh';
import { parseWhatsAppSettings, WHATSAPP_SETTINGS_KEY } from './whatsapp-settings';
import { runWhatsAppTransaction } from './whatsapp-transaction';

const conflict = (reason = 'SOURCE_CHANGED') => createApiError({ code: 'CONFLICT', status: 409, message: '', detail: { reason } });
export async function retryFailedWhatsApp(actor: CurrentUser, id: string, expectedUpdatedAt: string) {
  if (actor.role !== 'ADMIN') throw createApiError({ code: 'FORBIDDEN', status: 403, message: '' });
  const original = await db.whatsAppDelivery.findUnique({ where: { id } });
  if (!original || !isExplicitWhatsAppFailure(original) || original.updatedAt.toISOString() !== expectedUpdatedAt) throw conflict();
  const ancestors = await failedRetryAncestors(db, original);
  if (!ancestors) throw conflict();
  const verified = [original, ...ancestors];
  for (const row of verified) if (!await verifyFailedWhatsAppProvider(row)) throw conflict('PROVIDER_FAILURE_UNCONFIRMED');
  const templates = await listWhatsAppTemplateVersions();
  return runWhatsAppTransaction(async tx => {
    const contact = await tx.customerWhatsAppContact.findUniqueOrThrow({ where: { id: original.contactId } });
    // Same customer lock as the reminder scheduler prevents retry/new-slot races.
    await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${contact.customerId} FOR UPDATE`;
    for (const row of verified) {
      await tx.$queryRaw`SELECT id FROM WhatsAppDelivery WHERE id = ${row.id} FOR UPDATE`;
      const current = await tx.whatsAppDelivery.findUnique({ where: { id: row.id } });
      if (!current || !isExplicitWhatsAppFailure(current) || current.updatedAt.getTime() !== row.updatedAt.getTime()) throw conflict();
    }
    if (await tx.whatsAppDelivery.findFirst({ where: { retryOf: id } })) throw conflict('RETRY_EXISTS');
    const settingsRow = await tx.systemSetting.findUnique({ where: { key: WHATSAPP_SETTINGS_KEY } });
    const settings = parseWhatsAppSettings(settingsRow ? JSON.parse(settingsRow.value) : {});
    const reminder = original.type === 'OUTSTANDING_REMINDER';
    if (!settings.outboundEnabled) throw conflict('OUTBOUND_DISABLED');
    if (original.testMode !== (reminder ? settings.reminderTestMode : settings.testMode)) throw conflict('MODE_CHANGED');
    if (!reminder && !settings.enabledTypes.includes(original.type as 'PAYMENT_RECEIVED' | 'SHIPMENT' | 'RELEASE')) throw conflict('TYPE_DISABLED');
    const retry = await tx.whatsAppDelivery.create({ data: {
      eventKey: `retry:${id}`, retryOf: id, type: original.type, sourceId: original.sourceId,
      contactId: original.contactId, testMode: original.testMode,
      intendedTo: original.intendedTo, actualTo: original.testMode ? settings.testDestination : original.actualTo,
      senderPhone: original.senderPhone, templateName: original.templateName, languageCode: original.languageCode,
      parameters: original.parameters as Prisma.InputJsonValue, businessSnapshot: original.businessSnapshot as Prisma.InputJsonValue,
      correctionOf: original.correctionOf ?? Prisma.DbNull,
      requiresApproval: original.testMode || original.requiresApproval || Boolean(original.correctionOf),
      status: original.testMode || original.requiresApproval || original.correctionOf ? 'PENDING' : 'QUEUED',
      nextSendAt: bufferDeadline(),
    } });
    await refreshWhatsAppInTransaction(tx, retry.id, templates);
    const refreshed = await tx.whatsAppDelivery.findUniqueOrThrow({ where: { id: retry.id } });
    if (!['PENDING', 'QUEUED', 'PAUSED'].includes(refreshed.status)
      || (refreshed.failureCode && refreshed.failureCode !== 'DELETION_PENDING')) throw conflict(refreshed.failureCode || 'SOURCE_CHANGED');
    if (!templates.some(t => t.name === refreshed.templateName && t.language === refreshed.languageCode
      && t.active && t.status === 'APPROVED' && t.category === 'UTILITY')) throw conflict('TEMPLATE_REQUIRED');
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'WHATSAPP_DELIVERY_RETRY_CREATED', targetType: 'WHATSAPP_DELIVERY', targetId: retry.id,
      metadata: { retryOf: id, originalFailureCode: original.failureCode, originalProviderMessageId: original.providerMessageId,
        intendedTo: refreshed.intendedTo, actualTo: refreshed.actualTo, status: refreshed.status, nextSendAt: refreshed.nextSendAt?.toISOString() } } });
    return refreshed;
  });
}
