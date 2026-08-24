import { buildDashboardOutstandingSnapshot } from '@/lib/dashboard-customer-outstanding';

const receipt = (usd: number, status: string) => ({ usd, status });

const order = (
  id: string,
  orderNo: string,
  customerId: string | null,
  amount: number,
  receipts: Array<{ usd: number; status: string }>,
) => ({
  id,
  orderNo,
  customerId,
  customerName: customerId ? 'Alpha Buyer' : null,
  customerMark: customerId ? 'AB' : null,
  amount,
  orderBalance: amount,
  receipts,
});

const invoice = (
  id: string,
  releaseDate: string | null,
  orders: ReturnType<typeof order>[],
) => ({
  id,
  invNo: id,
  releaseDate: releaseDate ? new Date(releaseDate) : null,
  orders,
});

describe('buildDashboardOutstandingSnapshot', () => {
  it('uses live balances for customer totals and released/in-transit subtotals', () => {
    const snapshot = buildDashboardOutstandingSnapshot([
      invoice('INV-1', '2026-08-01T00:00:00.000Z', [
        order('order-1', 'AB-01', 'customer-1', 1000, [receipt(250, 'RECEIVED')]),
      ]),
      invoice('INV-2', null, [
        order('order-2', 'AB-02', 'customer-1', 500, [receipt(100, 'SIGNING_PENDING')]),
      ]),
    ], Date.parse('2026-08-24T00:00:00.000Z'));

    expect(snapshot.unpaidTotal).toBe(1250);
    expect(snapshot.orderBalances).toEqual(new Map([
      ['order-1', 750],
      ['order-2', 500],
    ]));
    expect(snapshot.customerOutstanding).toEqual([
      expect.objectContaining({
        customerId: 'customer-1',
        customerKey: 'customer:customer-1',
        totalOutstanding: 1250,
        statusSubtotals: { released: 750, inTransit: 500 },
      }),
    ]);
    expect(snapshot.releasedInvoices).toEqual([
      expect.objectContaining({
        invNo: 'INV-1',
        outstanding: 750,
        daysSinceRelease: 23,
      }),
    ]);
  });

  it('keeps an explicit null customer id for invalid unbound outstanding rows', () => {
    const snapshot = buildDashboardOutstandingSnapshot([
      invoice('INV-3', null, [
        order('order-unbound', 'UNKNOWN-01', null, 300, []),
      ]),
    ], Date.parse('2026-08-24T00:00:00.000Z'));

    expect(snapshot.customerOutstanding).toEqual([
      expect.objectContaining({
        customerId: null,
        customerKey: 'order:order-unbound',
        customerLabel: 'UNKNOWN-01',
        totalOutstanding: 300,
      }),
    ]);
  });
});
