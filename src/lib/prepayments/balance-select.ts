// Reused by every balance reader; original receipt amounts remain intact for
// income/history views while only applied contributions affect an invoice.
export const receiptBalanceSelect = {
  usd: true, status: true, funding: { select: { id: true } },
} as const;
export const paymentAllocationsSelect = {
  where: { state: 'APPLIED' },
  select: { amount: true, appliedAt: true,
    funding: { select: { active: true, originalReceiptId: true,
      receipt: { select: { id: true, usd: true, status: true, createdAt: true } } } } },
} as const;
