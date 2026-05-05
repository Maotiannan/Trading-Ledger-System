import { orderInvoicesForDisplay } from './use-invoice-ordering';
import type { Invoice } from '@/lib/store';

describe('orderInvoicesForDisplay', () => {
  it('puts active invoices before completed invoices and null ship dates first within each group', () => {
    const invoices = [
      { id: 'done-dated', invNo: 'INV-D1', invBalance: 0, shipDate: '2026-05-02T00:00:00.000Z' },
      { id: 'active-dated', invNo: 'INV-A2', invBalance: 10, shipDate: '2026-05-03T00:00:00.000Z' },
      { id: 'active-null', invNo: 'INV-A1', invBalance: 10, shipDate: null },
      { id: 'done-null', invNo: 'INV-D0', invBalance: 0, shipDate: null },
    ] as Invoice[];

    expect(orderInvoicesForDisplay(invoices).map((row) => row.id)).toEqual([
      'active-null',
      'active-dated',
      'done-null',
      'done-dated',
    ]);
  });
});
