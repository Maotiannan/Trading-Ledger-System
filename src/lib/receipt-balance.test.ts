import { buildReceiptBalanceAfterMap } from '@/lib/receipt-balance';

describe('receipt-balance', () => {
  it('calculates remaining balance after each receipt in chronological order', () => {
    const result = buildReceiptBalanceAfterMap([
      { id: 'receipt-2', orderId: 'order-1', usd: 15, createdAt: '2026-05-05T02:00:00.000Z' },
      { id: 'receipt-1', orderId: 'order-1', usd: 30, createdAt: '2026-05-04T02:00:00.000Z' },
      { id: 'receipt-3', orderId: 'order-1', usd: 5, createdAt: '2026-05-05T02:00:00.000Z' },
    ], new Map([['order-1', 100]]));

    expect(result.get('receipt-1')).toBe(70);
    expect(result.get('receipt-2')).toBe(55);
    expect(result.get('receipt-3')).toBe(50);
  });

  it('returns null when a receipt has no associated order amount context', () => {
    const result = buildReceiptBalanceAfterMap([
      { id: 'receipt-1', orderId: null, usd: 30, createdAt: '2026-05-04T02:00:00.000Z' },
      { id: 'receipt-2', orderId: 'order-2', usd: 15, createdAt: '2026-05-05T02:00:00.000Z' },
    ], new Map());

    expect(result.get('receipt-1')).toBeNull();
    expect(result.get('receipt-2')).toBeNull();
  });
});
