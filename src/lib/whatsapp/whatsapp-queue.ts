import { randomUUID } from 'node:crypto';
import { Prisma, WhatsAppNotificationType } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';
import { normalizeWhatsAppCustomerPhone } from './customer-phone';

type QueueClient = Pick<DbTransactionClient, 'whatsAppDelivery' | 'customerWhatsAppContact'>;
const PHONE = /^\+[1-9]\d{1,14}$/;

// Internal transaction API; callers provide a snapshot from the shared business projector.
export async function enqueueWhatsAppInTransaction(tx: QueueClient, input: {
  eventKey: string;
  type: WhatsAppNotificationType;
  sourceId: string;
  contactId: string;
  testMode: boolean;
  testDestination?: string;
  senderPhone: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
  businessSnapshot: Prisma.InputJsonObject;
}) {
  const contact = await tx.customerWhatsAppContact.findUnique({
    where: { id: input.contactId }, include: { customer: { select: { phone: true } } },
  });
  if (!contact?.optedInAt || (contact.optedOutAt && contact.optedOutAt >= contact.optedInAt)) {
    return { created: false, reason: 'CONSENT_REQUIRED' as const };
  }
  // Preserve deliveries created with older contact-based event keys too.
  const existing = await tx.whatsAppDelivery.findFirst({
    where: { sourceId: input.sourceId, type: input.type, contact: { customerId: contact.customerId } },
  });
  if (existing) return { delivery: existing };
  const intendedTo = normalizeWhatsAppCustomerPhone(contact.customer.phone);
  if (!intendedTo) return { created: false, reason: 'INVALID_CUSTOMER_PHONE' as const };
  const actualTo = input.testMode ? input.testDestination : intendedTo;
  if (!actualTo || !PHONE.test(actualTo) || !PHONE.test(input.senderPhone)
    || !input.eventKey.trim() || !input.templateName.trim() || !input.languageCode.trim()) {
    throw new Error('Invalid WhatsApp delivery configuration.');
  }
  // A repeated business event never rewrites an approved/test/sent snapshot.
  const row = await tx.whatsAppDelivery.upsert({
    where: { eventKey: input.eventKey }, update: {},
    create: {
      eventKey: input.eventKey, type: input.type, sourceId: input.sourceId, contactId: contact.id,
      testMode: input.testMode, intendedTo, actualTo, senderPhone: input.senderPhone,
      templateName: input.templateName, languageCode: input.languageCode,
      parameters: input.parameters, businessSnapshot: input.businessSnapshot,
      status: input.testMode ? 'PENDING' : 'QUEUED',
    },
  });
  return { delivery: row };
}

export async function approveWhatsAppTestInTransaction(tx: QueueClient, id: string, actor: CurrentUser) {
  if (actor.role !== 'ADMIN') throw new Error('Administrator access required.');
  return tx.whatsAppDelivery.updateMany({
    where: { id, testMode: true, status: 'PENDING' },
    data: { status: 'QUEUED', approvedBy: actor.id, approvedAt: new Date() },
  });
}

export async function claimWhatsAppInTransaction(
  tx: QueueClient, id: string, settings: { outboundEnabled: boolean; testMode: boolean; testDestination?: string },
) {
  if (!settings.outboundEnabled) return null;
  const delivery = await tx.whatsAppDelivery.findUnique({
    where: { id }, include: { contact: { include: { customer: { select: { phone: true } } } } },
  });
  if (!delivery || delivery.status !== 'QUEUED' || delivery.testMode !== settings.testMode) return null;
  if (delivery.testMode && (!delivery.approvedBy || !delivery.approvedAt
    || delivery.actualTo !== settings.testDestination)) return null;
  const contact = delivery.contact;
  if (!contact.optedInAt || (contact.optedOutAt && contact.optedOutAt >= contact.optedInAt)) return null;
  const intendedTo = normalizeWhatsAppCustomerPhone(contact.customer.phone);
  if (!intendedTo) return null;
  const actualTo = delivery.testMode ? delivery.actualTo : intendedTo;
  const claimToken = randomUUID();
  const result = await tx.whatsAppDelivery.updateMany({
    where: { id, status: 'QUEUED', claimToken: null },
    data: { status: 'SENDING', claimToken, claimedAt: new Date(), intendedTo, actualTo },
  });
  // Never release or retry an expired SENDING claim automatically: provider deduplication is unverified.
  return result.count === 1 ? { ...delivery, intendedTo, actualTo, status: 'SENDING' as const, claimToken } : null;
}
