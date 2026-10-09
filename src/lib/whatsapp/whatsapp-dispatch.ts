import { db } from '@/lib/db';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
import { claimWhatsAppInTransaction } from './whatsapp-queue';
import { sendYCloudTemplate, WhatsAppProviderError } from './ycloud-provider';
import { getWhatsAppSettings } from './whatsapp-settings';
import { refreshWhatsAppInTransaction } from './whatsapp-refresh';
import { listWhatsAppTemplateVersions } from './whatsapp-template-service';
import { isYCloudTemplateApproved } from './ycloud-template-status';
import { logger } from '@/lib/logger';
import { failedRetryAncestors, verifyFailedWhatsAppProvider } from './whatsapp-retry-policy';

// Not scheduled until business projection, consent UI and isolated rollout checks are complete.
export async function dispatchWhatsAppDelivery(id: string) {
  const apiKey = process.env.YCLOUD_API_KEY?.trim();
  const senderPhone = process.env.YCLOUD_SENDER_PHONE?.trim();
  let settings = await getWhatsAppSettings();
  if (process.env.WHATSAPP_OUTBOUND_ENABLED !== 'true') return { sent: false };
  if (!apiKey || !senderPhone || !settings.outboundEnabled) return { sent: false };
  const templates = await listWhatsAppTemplateVersions();
  const preview = await runInTransaction(tx => refreshWhatsAppInTransaction(tx, id, templates));
  if (preview?.type === 'OUTSTANDING_REMINDER' && !settings.reminderEnabled && !preview.retryOf) return { sent: false };
  if (preview && preview.type !== 'OUTSTANDING_REMINDER' && settings.enabledTypes && !settings.enabledTypes.includes(preview.type)) return { sent: false };
  if (!preview || preview.status !== 'QUEUED' || !preview.nextSendAt || preview.nextSendAt > new Date() || !await isYCloudTemplateApproved({
    apiKey, wabaId: process.env.YCLOUD_WABA_ID || '', name: preview.templateName, language: preview.languageCode,
  })) return { sent: false };
  if (preview.retryOf) {
    const ancestors = await failedRetryAncestors(db, preview);
    if (!ancestors) return { sent: false };
    for (const parent of ancestors) if (!await verifyFailedWhatsAppProvider(parent)) return { sent: false };
  }
  settings = await getWhatsAppSettings();
  if (!settings.outboundEnabled) return { sent: false };
  const delivery = await runInTransaction(async (tx) => {
    const candidate = await refreshWhatsAppInTransaction(tx, id, templates);
    if (!candidate || candidate.senderPhone !== senderPhone || candidate.templateName !== preview.templateName
      || candidate.languageCode !== preview.languageCode) return null;
    if (!Array.isArray(candidate.parameters) || !candidate.parameters.every((value) => typeof value === 'string')) return null;
    return claimWhatsAppInTransaction(tx, id, candidate.type === 'OUTSTANDING_REMINDER'
      ? { ...settings, testMode: settings.reminderTestMode } : settings);
  });
  if (!delivery) return { sent: false };

  let imageId: string | undefined;
  if (delivery.type === 'OUTSTANDING_REMINDER') {
    try {
      const { prepareReminderMedia } = await import('./outstanding-reminder-media');
      imageId = await prepareReminderMedia(delivery, { apiKey, senderPhone });
    } catch {
      logger.error('Outstanding reminder image preparation failed', { deliveryId: id, code: 'REMINDER_IMAGE_FAILED' });
      await db.whatsAppDelivery.updateMany({ where: { id, claimToken: delivery.claimToken, status: 'SENDING' },
        data: { status: 'FAILED', failureCode: 'REMINDER_IMAGE_FAILED', claimToken: null, claimedAt: null } });
      return { sent: false };
    }
  }
  if (delivery.retryOf && !await failedRetryAncestors(db, delivery)) {
    await db.whatsAppDelivery.updateMany({ where: { id, claimToken: delivery.claimToken, status: 'SENDING' },
      data: { status: 'CANCELLED', failureCode: 'RETRY_SOURCE_NO_LONGER_FAILED' } });
    return { sent: false };
  }
  let providerMessageId: string;
  try {
    const result = await sendYCloudTemplate({
      externalId: delivery.id, to: delivery.actualTo, templateName: delivery.templateName,
      languageCode: delivery.languageCode, parameters: delivery.parameters as string[], ...(imageId ? { imageId } : {}),
    }, { apiKey, senderPhone });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    const rejected = error instanceof WhatsAppProviderError && error.kind === 'REJECTED';
    await db.whatsAppDelivery.updateMany({
      where: { id, claimToken: delivery.claimToken, status: 'SENDING' },
      data: { status: rejected ? 'FAILED' : 'UNCERTAIN', failureCode: rejected ? 'PROVIDER_REJECTED' : 'TRANSPORT_UNCERTAIN',
        ...(rejected ? { claimToken: null, claimedAt: null } : {}) },
    });
    return { sent: false, uncertain: !rejected };
  }
  // A callback may arrive first. Do not downgrade DELIVERED/READ or classify a
  // database write failure as a provider rejection eligible for a resend.
  await db.whatsAppDelivery.updateMany({
    where: { id, claimToken: delivery.claimToken, status: 'SENDING' },
    data: { status: 'ACCEPTED', providerMessageId },
  });
  return { sent: true, providerMessageId };
}
