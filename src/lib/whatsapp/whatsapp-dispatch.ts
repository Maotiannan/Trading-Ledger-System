import { db } from '@/lib/db';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
import { claimWhatsAppInTransaction } from './whatsapp-queue';
import { sendYCloudTemplate, WhatsAppProviderError } from './ycloud-provider';
import { getWhatsAppSettings } from './whatsapp-settings';
import { isDeepStrictEqual } from 'node:util';
import { isYCloudTemplateApproved } from './ycloud-template-status';

// Not scheduled until business projection, consent UI and isolated rollout checks are complete.
export async function dispatchWhatsAppDelivery(id: string) {
  const apiKey = process.env.YCLOUD_API_KEY?.trim();
  const senderPhone = process.env.YCLOUD_SENDER_PHONE?.trim();
  let settings = await getWhatsAppSettings();
  if (process.env.WHATSAPP_OUTBOUND_ENABLED !== 'true') return { sent: false };
  if (!apiKey || !senderPhone || !settings.outboundEnabled) return { sent: false };
  const preview = await db.whatsAppDelivery.findUnique({ where: { id } });
  if (preview && settings.enabledTypes && !settings.enabledTypes.includes(preview.type)) return { sent: false };
  if (!preview || preview.status !== 'QUEUED' || !await isYCloudTemplateApproved({
    apiKey, wabaId: process.env.YCLOUD_WABA_ID || '', name: preview.templateName, language: preview.languageCode,
  })) return { sent: false };
  settings = await getWhatsAppSettings();
  if (!settings.outboundEnabled) return { sent: false };
  const delivery = await runInTransaction(async (tx) => {
    const candidate = await tx.whatsAppDelivery.findUnique({ where: { id } });
    if (!candidate || candidate.senderPhone !== senderPhone) return null;
    const source = await tx.emailNotification.findUnique({ where: { id: candidate.sourceId } });
    let sourceValid = Boolean(source?.receiptId || source?.invoiceId);
    if (source?.receiptId) {
      const receipt = await tx.receipt.findUnique({ where: { id: source.receiptId } });
      const snapshot = candidate.businessSnapshot as Record<string, unknown>;
      sourceValid = Boolean(receipt && receipt.customerId === source.customerId
        && receipt.status !== 'SIGNING_PENDING' && !receipt.receiptNo?.startsWith('TRANSFER-')
        && Number(receipt.usd) === snapshot.amount
        && (receipt.orderNo || '').split('/').map(value => value.trim()).filter(Boolean).join('/')
          === (Array.isArray(snapshot.orderNos) ? snapshot.orderNos.join('/') : ''));
    } else if (source?.invoiceId) {
      const invoice = await tx.invoice.findUnique({ where: { id: source.invoiceId }, include: { orders: { select: { customerId: true } } } });
      const snapshot = candidate.businessSnapshot as Record<string, unknown>;
      const date = source.type === 'SHIPMENT' ? invoice?.shipDate : invoice?.releaseDate;
      sourceValid = Boolean(invoice && invoice.orders.some(order => order.customerId === source.customerId)
        && date?.toISOString() === (source.type === 'SHIPMENT' ? snapshot.shipmentDate : snapshot.releaseDate));
    }
    if (!sourceValid || !source || (source.correctionReason && !['SOURCE_CHANGED', 'ADMIN_CANCELLED'].includes(source.correctionReason))
      || !isDeepStrictEqual(source.currentSnapshot, candidate.businessSnapshot)) {
      await tx.whatsAppDelivery.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'CANCELLED', failureCode: 'SOURCE_CHANGED' } });
      return null;
    }
    if (!Array.isArray(candidate.parameters) || !candidate.parameters.every((value) => typeof value === 'string')) return null;
    return claimWhatsAppInTransaction(tx, id, settings);
  });
  if (!delivery) return { sent: false };

  let providerMessageId: string;
  try {
    const result = await sendYCloudTemplate({
      externalId: delivery.id, to: delivery.actualTo, templateName: delivery.templateName,
      languageCode: delivery.languageCode, parameters: delivery.parameters as string[],
    }, { apiKey, senderPhone });
    providerMessageId = result.providerMessageId;
  } catch (error) {
    const rejected = error instanceof WhatsAppProviderError && error.kind === 'REJECTED';
    await db.whatsAppDelivery.updateMany({
      where: { id, claimToken: delivery.claimToken, status: 'SENDING' },
      data: { status: rejected ? 'FAILED' : 'UNCERTAIN', failureCode: rejected ? 'PROVIDER_REJECTED' : 'TRANSPORT_UNCERTAIN' },
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
