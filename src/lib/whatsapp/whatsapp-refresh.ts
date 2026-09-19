import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { EDITABLE_WHATSAPP_STATUSES, pendingDeliveryUpdate } from './whatsapp-buffer';
import { resolveWhatsAppSource } from './whatsapp-live-source';
import { normalizeWhatsAppCustomerPhone } from './customer-phone';
import { renderWhatsAppSnapshot } from './whatsapp-template';
import type { TemplateVersion } from './whatsapp-template-definition';
import { refreshCorrectionInTransaction } from './whatsapp-corrections';

export async function refreshWhatsAppInTransaction(tx: DbTransactionClient, id: string, templates: TemplateVersion[]) {
  const delivery = await tx.whatsAppDelivery.findUnique({ where: { id } });
  if (!delivery || !EDITABLE_WHATSAPP_STATUSES.some(status => status === delivery.status)) return delivery;
  if (delivery.correctionOf) return refreshCorrectionInTransaction(tx, delivery, templates);
  const source = await tx.emailNotification.findUnique({ where: { id: delivery.sourceId } });
  const live = source ? await resolveWhatsAppSource(tx, source) : null;
  const where = { id, status: delivery.status, updatedAt: delivery.updatedAt, claimToken: null };
  if (!live) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'CANCELLED', failureCode: 'SOURCE_REMOVED' } });
    return null;
  }
  const contact = await tx.customerWhatsAppContact.findFirst({ where: {
    customerId: live.customer.id, optedInAt: { lte: source!.createdAt }, optedOutAt: null,
  }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
  if (!contact) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'CANCELLED', failureCode: 'CONSENT_REVOKED' } });
    return null;
  }
  const intendedTo = normalizeWhatsAppCustomerPhone(live.customer.phone);
  if (!intendedTo) {
    await tx.whatsAppDelivery.updateMany({ where, data: { status: 'PAUSED', failureCode: 'INVALID_CUSTOMER_PHONE', approvedAt: null, approvedBy: null } });
    return null;
  }
  const rendered = renderWhatsAppSnapshot(delivery.type, live.snapshot, templates);
  const actualTo = delivery.testMode ? delivery.actualTo : intendedTo;
  const changed = !isDeepStrictEqual(delivery.businessSnapshot, live.snapshot)
    || !isDeepStrictEqual(delivery.parameters, rendered.parameters)
    || delivery.templateName !== rendered.templateName || delivery.languageCode !== rendered.languageCode
    || delivery.contactId !== contact.id || delivery.intendedTo !== intendedTo || delivery.actualTo !== actualTo;
  const state = pendingDeliveryUpdate({ paused: live.paused, wasPaused: delivery.status === 'PAUSED', changed,
    requiresApproval: delivery.testMode || delivery.requiresApproval });
  if (!changed && Object.keys(state).length === 0) return delivery;
  const data = { ...state, contactId: contact.id, intendedTo, actualTo,
    templateName: rendered.templateName, languageCode: rendered.languageCode, parameters: rendered.parameters,
    businessSnapshot: live.snapshot as Prisma.InputJsonObject };
  const result = await tx.whatsAppDelivery.updateMany({ where, data });
  if (result.count !== 1) return null;
  return tx.whatsAppDelivery.findUnique({ where: { id } });
}
