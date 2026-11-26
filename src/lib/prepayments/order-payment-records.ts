import { db } from '@/lib/db';
import { buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { addMoney, moneyToNumber, type MoneyInput } from '@/lib/money';
import { isReceiptIncludedInOrderBalance } from '@/lib/order-balance';

type ReceiptRow = {
  id: string; receiptNo: string | null; orderId: string | null; usd: MoneyInput; status: string;
  date: Date | null; createdAt: Date; payer: string | null; invNo: string | null; orderNo: string | null;
  imageUrl: string | null; imageName: string | null; funding: { id: string } | null;
};
type AllocationRow = {
  orderId: string | null; state: string; amount: MoneyInput; appliedAt: Date | null;
  funding: { id: string; active: boolean; originalReceiptId: string; receipt: { status: string } | null };
};
type OrderPaymentRecord = Omit<ReceiptRow, 'funding' | 'orderId' | 'usd' | 'createdAt'> & {
  usd: number; createdAt: Date | null; originalReceiptAmount: number | null; appliedToOrderAmount: number;
  paymentSource: string; sourceRestricted: boolean;
};

export function projectOrderPaymentRecords(orderId: string, receipts: ReceiptRow[], allocations: AllocationRow[]) {
  const applied = new Map<string, { amount: number; fundingId: string; appliedAt: Date | null }>();
  for (const row of allocations) {
    if (row.orderId !== orderId || row.state !== 'APPLIED' || !row.funding.active || !row.funding.receipt
      || !isReceiptIncludedInOrderBalance(row.funding.receipt.status)) continue;
    const id = row.funding.originalReceiptId;
    const prior = applied.get(id);
    applied.set(id, { amount: moneyToNumber(addMoney([prior?.amount || 0, row.amount])), fundingId: row.funding.id,
      appliedAt: prior?.appliedAt && (!row.appliedAt || prior.appliedAt > row.appliedAt) ? prior.appliedAt : row.appliedAt });
  }
  const rows: OrderPaymentRecord[] = receipts.map(({ funding, orderId: receiptOrderId, usd, ...receipt }) => {
    const allocated = applied.get(receipt.id);
    applied.delete(receipt.id);
    return { ...receipt, usd: moneyToNumber(usd), originalReceiptAmount: moneyToNumber(usd),
      appliedToOrderAmount: allocated?.amount ?? (!funding && receiptOrderId === orderId
        && isReceiptIncludedInOrderBalance(receipt.status) ? moneyToNumber(usd) : 0),
      paymentSource: funding ? 'ALLOCATION' : 'DIRECT', sourceRestricted: false };
  });
  // Target visibility permits its contribution, not the source payer, receipt or image.
  for (const row of applied.values()) rows.push({ id: `allocation:${row.fundingId}`, receiptNo: null, payer: null,
    usd: row.amount, originalReceiptAmount: null, appliedToOrderAmount: row.amount,
    status: 'APPLIED', date: null, createdAt: row.appliedAt, invNo: null, orderNo: null, imageUrl: null, imageName: null,
    paymentSource: 'ALLOCATION', sourceRestricted: true });
  return rows.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime()
    || a.id.localeCompare(b.id));
}

export async function loadOrderPaymentRecords(orderId: string, ownerIds: string[]) {
  const allocations = await db.prepaymentAllocation.findMany({ where: {
    orderId, state: 'APPLIED', funding: { active: true, receipt: { status: { not: 'SIGNING_PENDING' } } },
  }, select: { orderId: true, state: true, amount: true, appliedAt: true,
    funding: { select: { id: true, active: true, originalReceiptId: true, receipt: { select: { status: true } } } } } });
  const receipts = await db.receipt.findMany({ where: { AND: [buildReceiptVisibilityWhere(ownerIds),
    { OR: [{ orderId }, { id: { in: [...new Set(allocations.map(row => row.funding.originalReceiptId))] } }] }],
  }, select: { id: true, receiptNo: true, orderId: true, usd: true, status: true, date: true, createdAt: true,
    payer: true, invNo: true, orderNo: true, imageUrl: true, imageName: true, funding: { select: { id: true } } } });
  return projectOrderPaymentRecords(orderId, receipts, allocations);
}
