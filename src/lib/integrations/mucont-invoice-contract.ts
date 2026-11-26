import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { groupChangesSchema } from '@/lib/prepayments/group-changes-contract';

export class MucontInvoiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function invoiceConflict(message: string): never {
  throw new MucontInvoiceError(409, 'INVOICE_SOURCE_CONFLICT', message);
}
const id = z.string().min(1).max(128);
const money = z.string().regex(/^(0|[1-9]\d{0,15})\.\d{2}$/);
const adjustment = z.string().regex(/^-?(0|[1-9]\d{0,15})\.\d{2}$/);
const customerSchema = z.strictObject({
  billingGroupId: id, muledgerCustomerId: id,
  customerSnapshot: z.strictObject({ mark: z.string(), name: z.string(), phone: z.string().nullable(), city: z.string().nullable() }),
  orderRefs: z.array(z.strictObject({ sourceOrderNo: z.string().min(1).max(191), displayOrderNo: z.string().min(1).max(191) })).min(1),
  goodsAmount: money, adjustmentAmount: adjustment, freightAmount: money, totalAmount: money,
});
const generationSchema = z.strictObject({
  schemaVersion: z.literal(1), source: z.literal('MUCONT'), generationId: id,
  invoiceBatchId: id, publicationSequence: z.number().int().min(1).max(2147483647),
  invoiceNo: id, generatedAt: z.iso.datetime(), documentVersion: z.number().int().positive(),
  currency: z.literal('USD'), invoiceTotal: money, customers: z.array(customerSchema), groupChanges: groupChangesSchema.optional(),
});
export type InvoiceGeneration = z.infer<typeof generationSchema>;

export function parseInvoiceGeneration(input: unknown): InvoiceGeneration {
  const parsed = generationSchema.safeParse(input);
  if (!parsed.success) throw new MucontInvoiceError(422, 'INVALID_GENERATION', 'Invalid invoice generation payload.');
  const value = parsed.data;
  if ((!value.customers.length && !value.groupChanges?.cancelInvoice)
    || (value.groupChanges?.cancelInvoice && (value.customers.length || value.invoiceTotal !== '0.00'))) {
    throw new MucontInvoiceError(422, 'INVALID_CANCELLATION', 'Empty invoices require explicit cancellation.');
  }
  const groups = new Set<string>();
  let total = new Prisma.Decimal(0);
  for (const customer of value.customers) {
    const sum = new Prisma.Decimal(customer.goodsAmount).plus(customer.adjustmentAmount).plus(customer.freightAmount);
    if (!sum.equals(customer.totalAmount) || groups.has(customer.billingGroupId)) {
      throw new MucontInvoiceError(422, 'INVALID_TOTAL_OR_GROUP', 'Inconsistent totals or duplicate billing group.');
    }
    const refs = customer.orderRefs.map((ref) => JSON.stringify(ref));
    if (new Set(refs).size !== refs.length) throw new MucontInvoiceError(422, 'DUPLICATE_ORDER_REF', 'Duplicate order reference.');
    groups.add(customer.billingGroupId);
    total = total.plus(customer.totalAmount);
  }
  if (!total.equals(value.invoiceTotal)) throw new MucontInvoiceError(422, 'INVALID_INVOICE_TOTAL', 'Invoice total does not match customer totals.');
  return value;
}

export function invoicePayloadHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const date = z.iso.date().nullable();
const available = z.strictObject({
  invoiceBatchId: id, availability: z.literal('available'), metadataVersion: z.number().int().positive(),
  sourceUpdatedAt: z.iso.datetime({ offset: true }),
  departureDate: date, estimatedArrivalDate: date, releaseDate: date,
  creditInsurance: z.strictObject({ creditRecordId: z.string().nullable(), companyName: z.string(), sourceVersion: z.string().nullable() }).nullable(),
  billOfLading: z.strictObject({ versionId: id, fileName: z.string().min(1), contentType: z.string().min(1), byteSize: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).nullable(),
});
export const metadataSchema = z.strictObject({
  schemaVersion: z.literal(1), items: z.array(z.union([available,
    z.strictObject({ invoiceBatchId: id, availability: z.enum(['not_found', 'deleted']) }),
  ])).max(100),
});
export type InvoiceMetadata = z.infer<typeof available>;
