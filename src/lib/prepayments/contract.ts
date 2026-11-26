import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { groupChangesSchema } from './group-changes-contract';

export const identity = z.string().min(1).max(128).regex(/^\S(?:.*\S)?$/);
export const orderNumber = z.string().min(1).max(191).regex(/^\S(?:.*\S)?$/);
export const money = z.string().regex(/^(0|[1-9]\d{0,15})\.\d{2}$/);
export const signedMoney = z.string().regex(/^-?(0|[1-9]\d{0,15})\.\d{2}$/);
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const planReferenceSchema = z.strictObject({ planId: identity, version: z.number().int().positive(), hash: digest });
export const sourceBindingSchema = z.strictObject({ type: z.enum(['MUCONT_PI', 'LEDGER_TRACKER', 'LEDGER_ORDER', 'LEDGER_SOURCE']), id: identity });
export const sourceOrderSchema = z.strictObject({ binding: sourceBindingSchema.nullable(), sourceOrderNo: orderNumber, displayOrderNo: orderNumber });
export const financialGroupSchema = z.strictObject({
  billingGroupId: identity, muledgerCustomerId: identity,
  orderRefs: z.array(sourceOrderSchema).min(1).max(200),
  goodsAmount: money, adjustmentAmount: signedMoney, freightAmount: money, totalAmount: money,
});
export const financialSnapshotSchema = z.strictObject({
  invoiceBatchId: identity, invoiceNo: identity, currency: z.literal('USD'),
  invoiceTotal: money, customers: z.array(financialGroupSchema).max(200), groupChanges: groupChangesSchema.optional(),
});
export const previewRequestSchema = z.strictObject({ schemaVersion: z.literal(2), snapshot: financialSnapshotSchema });
export const reserveRequestSchema = z.strictObject({
  schemaVersion: z.literal(2), requestId: identity, mode: z.enum(['REUSE', 'RECALCULATE']),
  snapshot: financialSnapshotSchema, expectedRevision: digest.nullable(), previousPlan: planReferenceSchema.nullable(),
});
export const releaseRequestSchema = z.strictObject({
  schemaVersion: z.literal(2), requestId: identity, expectedVersion: z.number().int().positive(), reason: z.string().min(1).max(500),
});
export const transferRequestSchema = z.strictObject({
  requestId: identity, creditId: identity, expectedRevision: digest,
  targetCustomerId: identity, targetBinding: z.strictObject({ type: z.enum(['LEDGER_ORDER', 'LEDGER_TRACKER', 'LEDGER_SOURCE']), id: identity }),
  amount: money, reason: z.string().min(1).max(500),
});
export const reverseTransferRequestSchema = z.strictObject({ requestId: identity, reason: z.string().min(1).max(500) });
const customerSnapshotSchema = z.strictObject({ mark: z.string(), name: z.string(), phone: z.string().nullable(), city: z.string().nullable() });
export const generationRequestSchema = z.strictObject({
  schemaVersion: z.literal(2), source: z.literal('MUCONT'), generationId: identity,
  publicationSequence: z.number().int().min(1).max(2147483647), generatedAt: z.iso.datetime(),
  documentVersion: z.number().int().positive(), snapshot: financialSnapshotSchema, plan: planReferenceSchema,
  customerSnapshots: z.array(z.strictObject({ billingGroupId: identity, customerSnapshot: customerSnapshotSchema })).max(200),
});
export const fundingLineSchema = z.strictObject({
  creditId: identity, receiptId: identity, receiptNo: z.string().nullable(), sourceOrderNo: z.string(),
  originCustomerId: identity, availableAmount: money, usedAmount: money, reservedAmount: money,
});
export const groupQuoteSchema = z.strictObject({
  billingGroupId: identity, muledgerCustomerId: identity, totalAmount: money,
  paidAmount: money, availableAmount: money, additionalAmount: money, remainingAmount: money,
  sources: z.array(fundingLineSchema),
});
export const previewResponseSchema = z.strictObject({
  schemaVersion: z.literal(2), financialHash: digest, revision: digest, calculatedAt: z.iso.datetime(),
  snapshot: financialSnapshotSchema, previousPlan: planReferenceSchema.nullable(), groups: z.array(groupQuoteSchema),
});
export const allocationLineSchema = z.strictObject({ creditId: identity, receiptId: identity, amount: money });
export const planGroupSchema = z.strictObject({
  billingGroupId: identity, muledgerCustomerId: identity, totalAmount: money,
  paidBeforeAmount: money, prepaymentAmount: money, paidAmount: money, remainingAmount: money,
  unusedAmount: money, allocations: z.array(allocationLineSchema),
});
export const planResponseSchema = z.strictObject({
  schemaVersion: z.literal(2), requestId: identity, plan: planReferenceSchema,
  state: z.enum(['RESERVED', 'APPLIED', 'RELEASED', 'SUPERSEDED']), financialHash: digest,
  paymentSnapshotAt: z.iso.datetime(), snapshot: financialSnapshotSchema,
  groups: z.array(planGroupSchema), ledgerInvoiceId: identity.nullable(),
});
export const generationResponseSchema = z.strictObject({
  schemaVersion: z.literal(2), generationId: identity, invoiceBatchId: identity,
  publicationSequence: z.number().int().positive(), result: z.enum(['APPLIED', 'DUPLICATE', 'IGNORED_STALE']),
  ledgerInvoiceId: identity.nullable(), plan: planReferenceSchema,
});
export const errorResponseSchema = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string(), retryable: z.boolean() }) });

export type FinancialSnapshot = z.infer<typeof financialSnapshotSchema>;
export type ReserveRequest = z.infer<typeof reserveRequestSchema>;
export type PlanReference = z.infer<typeof planReferenceSchema>;
export type PlanResponse = z.infer<typeof planResponseSchema>;
export type GroupQuote = z.infer<typeof groupQuoteSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export class PrepaymentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function conflict(message: string, code = 'PREPAYMENT_CONFLICT'): never { throw new PrepaymentError(409, code, message); }
export function utf8Compare(a: string, b: string) { return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')); }
export function canonicalHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => utf8Compare(a, b)).map(([key, val]) => [key, canonical(val)])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateSnapshot(value: FinancialSnapshot) {
  if (!value.customers.length && !value.groupChanges?.cancelInvoice) conflict('Empty invoices require explicit cancellation.');
  if (value.groupChanges?.cancelInvoice && (value.customers.length || value.invoiceTotal !== '0.00')) conflict('Cancelled invoices cannot contain receivables.');
  if (value.groupChanges?.removedBillingGroupIds.some(id => value.customers.some(group => group.billingGroupId === id))) conflict('A group cannot be retained and removed.');
  let total = new Prisma.Decimal(0);
  const groupIds = new Set<string>();
  const customerIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const group of value.customers) {
    if (groupIds.has(group.billingGroupId) || customerIds.has(group.muledgerCustomerId)) conflict('Each customer must have exactly one billing group.');
    groupIds.add(group.billingGroupId); customerIds.add(group.muledgerCustomerId);
    const sum = new Prisma.Decimal(group.goodsAmount).plus(group.adjustmentAmount).plus(group.freightAmount);
    if (sum.isNegative() || !sum.equals(group.totalAmount)) conflict('Customer group amounts do not reconcile.');
    total = total.plus(sum);
    for (const ref of group.orderRefs) {
      const key = ref.binding ? `${ref.binding.type}:${ref.binding.id}` : `${group.muledgerCustomerId}:${ref.sourceOrderNo.toUpperCase()}`;
      if (sourceIds.has(key)) conflict('An original ORDER must occur once in a financial snapshot.');
      sourceIds.add(key);
    }
  }
  if (!total.equals(value.invoiceTotal)) conflict('Invoice total does not reconcile.');
}
export function financialHash(value: FinancialSnapshot) {
  validateSnapshot(value);
  return canonicalHash({ invoiceBatchId: value.invoiceBatchId, currency: value.currency, invoiceTotal: value.invoiceTotal,
    ...(value.groupChanges ? { groupChanges: { ...value.groupChanges, removedBillingGroupIds: [...value.groupChanges.removedBillingGroupIds].sort(utf8Compare) } } : {}),
    customers: [...value.customers].sort((a, b) => utf8Compare(a.billingGroupId, b.billingGroupId)).map(group => ({
      billingGroupId: group.billingGroupId, muledgerCustomerId: group.muledgerCustomerId,
      goodsAmount: group.goodsAmount, adjustmentAmount: group.adjustmentAmount, freightAmount: group.freightAmount, totalAmount: group.totalAmount,
      sources: group.orderRefs.map(ref => ref.binding || { type: 'UNBOUND', id: ref.sourceOrderNo })
        .sort((a, b) => utf8Compare(`${a.type}:${a.id}`, `${b.type}:${b.id}`)),
    })) });
}

export const contractSchemas = {
  financialSnapshot: financialSnapshotSchema, previewRequest: previewRequestSchema, reserveRequest: reserveRequestSchema,
  releaseRequest: releaseRequestSchema, transferRequest: transferRequestSchema, reverseTransferRequest: reverseTransferRequestSchema,
  generationRequest: generationRequestSchema, previewResponse: previewResponseSchema, planResponse: planResponseSchema,
  generationResponse: generationResponseSchema, errorResponse: errorResponseSchema,
};
