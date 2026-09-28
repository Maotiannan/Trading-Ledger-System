import { buildCustomerOutstandingStatementSvg } from './customer-outstanding-export-image';

describe('customer outstanding statement export', () => {
  it('renders DAYS for released orders and omits it from in-transit rows', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['logo'], { type: 'image/png' }),
    } as Response);
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchMock });

    const svg = await buildCustomerOutstandingStatementSvg({
      customerMark: 'AB',
      statementDate: '28/09/2026',
      outstanding: {
        customerId: 'customer-1',
        customerKey: 'customer:customer-1',
        customerLabel: 'AB',
        customerMark: 'AB',
        totalOutstanding: 1250,
        statusSubtotals: { released: 750, inTransit: 500 },
        orders: [
          { orderId: 'released', orderNo: 'AB-01', invNo: 'INV-1', outstanding: 750, statusGroup: 'RELEASED', releaseDate: '2026-08-01', daysSinceRelease: 23 },
          { orderId: 'transit', orderNo: 'AB-02', invNo: 'INV-2', outstanding: 500, statusGroup: 'IN_TRANSIT', releaseDate: null, daysSinceRelease: null },
        ],
      },
      labels: {
        title: 'Customer Outstanding Statement', customer: 'Customer', statementDate: 'Statement Date',
        totalUnpaid: 'Total Unpaid', released: 'Released Orders', inTransit: 'In-Transit Orders',
        orderNo: 'ORDER NO', balance: 'BALANCE', days: 'DAYS', subtotal: 'Subtotal', contactNote: 'Contact MU Group',
      },
    });

    expect(svg).toContain('DAYS');
    expect(svg).toContain('>23<');
    expect(fetchMock).toHaveBeenCalledWith('/detail-export/payment-detail-logo.png', { credentials: 'same-origin' });
    delete (global as { fetch?: unknown }).fetch;
  });
});
