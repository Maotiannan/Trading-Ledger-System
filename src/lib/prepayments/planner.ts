import { Prisma } from '@prisma/client';
import { conflict } from './contract';

type CreditInput = { creditId: string; receiptId: string; available: string; applied: string };
type Allocation = { creditId: string; receiptId: string; amount: string };
const decimal = (value: string) => new Prisma.Decimal(value);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), decimal('0'));

// Reuse actual allocations first. A re-render cannot switch which receipt paid
// the invoice merely because an older receipt was discovered later.
export function planCreditUse(total: string, paidBefore: string, credits: CreditInput[]) {
  let remaining = decimal(total).minus(paidBefore);
  if (remaining.isNegative()) conflict('Existing direct payments exceed the new receivable. Reconcile them before generating.');
  if (new Set(credits.map(row => row.creditId)).size !== credits.length) conflict('Duplicate credit source.');
  for (const row of credits) if (decimal(row.available).isNegative() || decimal(row.applied).isNegative()) conflict('Invalid credit balance.');
  const assigned = new Map<string, Prisma.Decimal>();
  for (const row of credits) {
    const used = Prisma.Decimal.min(decimal(row.applied), remaining);
    assigned.set(row.creditId, used);
    remaining = remaining.minus(used);
  }
  const reservations: Allocation[] = [];
  for (const row of credits) {
    const extra = Prisma.Decimal.min(decimal(row.available), remaining);
    if (extra.gt(0)) reservations.push({ creditId: row.creditId, receiptId: row.receiptId, amount: extra.toFixed(2) });
    assigned.set(row.creditId, assigned.get(row.creditId)!.plus(extra));
    remaining = remaining.minus(extra);
  }
  const allocations: Allocation[] = credits.flatMap(row => assigned.get(row.creditId)!.gt(0)
    ? [{ creditId: row.creditId, receiptId: row.receiptId, amount: assigned.get(row.creditId)!.toFixed(2) }] : []);
  const used = sum([...assigned.values()]);
  return { allocations, reservations, prepaymentAmount: used.toFixed(2), paidBeforeAmount: decimal(paidBefore).toFixed(2),
    paidAmount: used.plus(paidBefore).toFixed(2), remainingAmount: remaining.toFixed(2),
    unusedAmount: sum(credits.map(row => decimal(row.applied).plus(row.available))).minus(used).toFixed(2) };
}
