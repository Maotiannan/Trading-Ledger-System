import { z } from 'zod';
import { WhatsAppDeliveryStatus } from '@prisma/client';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';

const eventSchema = z.object({
  id: z.string().min(1).max(191),
  type: z.literal('whatsapp.message.updated'),
  createTime: z.string().datetime({ offset: true }),
  whatsappMessage: z.object({
    id: z.string().min(1).max(191),
    externalId: z.string().max(191).optional(),
    wabaId: z.string(),
    from: z.string(),
    to: z.string(),
    status: z.string(),
    errorCode: z.string().optional(),
  }),
});

export function parseYCloudDeliveryEvent(rawBody: string, scope: { wabaId: string; senderPhone: string }) {
  const event = eventSchema.parse(JSON.parse(rawBody));
  if (!scope.wabaId || !scope.senderPhone || event.whatsappMessage.wabaId !== scope.wabaId
    || event.whatsappMessage.from !== scope.senderPhone) {
    throw new Error('WhatsApp webhook account mismatch.');
  }
  return event;
}

// Persist a minimal status payload, not arbitrary inbound messages or provider diagnostics.
export async function storeYCloudDeliveryEvent(event: ReturnType<typeof parseYCloudDeliveryEvent>) {
  return runInTransaction(async (tx) => {
    const status = event.whatsappMessage.status.toLowerCase();
    const statusMap: Record<string, WhatsAppDeliveryStatus | undefined> = {
      accepted: WhatsAppDeliveryStatus.ACCEPTED,
      sent: WhatsAppDeliveryStatus.SENT,
      delivered: WhatsAppDeliveryStatus.DELIVERED,
      read: WhatsAppDeliveryStatus.READ,
      failed: WhatsAppDeliveryStatus.FAILED,
    };
    const nextStatus = statusMap[status];
    const row = await tx.whatsAppWebhookEvent.upsert({
      where: { providerEventId: event.id }, update: {},
      create: {
        providerEventId: event.id, eventType: event.type,
        providerMessageId: event.whatsappMessage.id, externalId: event.whatsappMessage.externalId,
        occurredAt: new Date(event.createTime), payload: event.whatsappMessage,
      },
      select: { id: true, appliedAt: true },
    });
    if (nextStatus && !row.appliedAt) {
      const delivery = await tx.whatsAppDelivery.findFirst({
        where: {
          senderPhone: event.whatsappMessage.from, actualTo: event.whatsappMessage.to,
          OR: [
            { providerMessageId: event.whatsappMessage.id },
            ...(event.whatsappMessage.externalId ? [{ id: event.whatsappMessage.externalId, providerMessageId: null }] : []),
          ],
        },
        select: { id: true, status: true, lastEventAt: true },
      });
      const rank: Record<WhatsAppDeliveryStatus, number> = { PAUSED: -1,
        PENDING: -1, QUEUED: -1, CANCELLED: -1, SENDING: 0, UNCERTAIN: 0,
        ACCEPTED: 1, SENT: 2, FAILED: 3, DELIVERED: 4, READ: 5,
      };
      if (delivery && rank[delivery.status] >= 0 && rank[nextStatus] > rank[delivery.status]) {
        const result = await tx.whatsAppDelivery.updateMany({
          where: { id: delivery.id, status: delivery.status },
          data: { status: nextStatus, providerMessageId: event.whatsappMessage.id, lastEventAt: new Date(event.createTime), failureCode: event.whatsappMessage.errorCode || null },
        });
        if (result.count === 1) {
          await tx.whatsAppWebhookEvent.update({ where: { id: row.id }, data: { deliveryId: delivery.id, appliedAt: new Date() } });
        }
      } else if (delivery && rank[delivery.status] >= 0) {
        await tx.whatsAppWebhookEvent.update({ where: { id: row.id }, data: { deliveryId: delivery.id, appliedAt: new Date() } });
      }
    }
    return { stored: true, eventId: row.id };
  });
}
