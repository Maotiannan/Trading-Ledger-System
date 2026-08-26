import { render, screen, within } from '@testing-library/react';
import { DashboardCustomerDetailDialog } from './dashboard-customer-detail-dialog';

const tx = (_zh: string, en: string) => en;
const noop = () => undefined;

const history = {
  orders: [{ id: 'order-1', orderNo: 'AB-01', invNo: 'INV-1', amount: 1000, outstanding: 750 }],
  orderPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
  receipts: [{
    id: 'receipt-1', receiptNo: '0010001', orderNo: 'AB-01', invNo: 'INV-1', usd: 250,
    status: 'RECEIVED', date: '2026-08-01', createdAt: '2026-08-02T08:00:00.000Z',
  }],
  receiptPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
};

const outstanding = {
  customerId: 'customer-1',
  customerKey: 'customer:customer-1',
  customerLabel: 'AB',
  totalOutstanding: 1250,
  statusSubtotals: { released: 750, inTransit: 500 },
  orders: [
    {
      orderId: 'order-released', orderNo: 'AB-01', invNo: 'INV-1', outstanding: 750,
      statusGroup: 'RELEASED' as const, releaseDate: '2026-08-01T00:00:00.000Z', daysSinceRelease: 23,
    },
    {
      orderId: 'order-transit', orderNo: 'AB-02', invNo: 'INV-2', outstanding: 500,
      statusGroup: 'IN_TRANSIT' as const, releaseDate: null, daysSinceRelease: null,
    },
  ],
};

const historyProps = {
  loading: false,
  error: '',
  history,
  tx,
  orderPageSizeOptions: [5, 10, 15, 20],
  receiptPageSizeOptions: [5, 10, 15, 20],
  onOrderPreviousPage: noop,
  onOrderNextPage: noop,
  onOrderPageSizeChange: noop,
  onReceiptPreviousPage: noop,
  onReceiptNextPage: noop,
  onReceiptPageSizeChange: noop,
};

describe('DashboardCustomerDetailDialog', () => {
  it('stacks outstanding status sections above order and receipt history', () => {
    render(
      <DashboardCustomerDetailDialog
        open
        customerId="customer-1"
        title="AB"
        outstanding={outstanding}
        historyProps={historyProps}
        unboundMessage="Customer history unavailable"
        tx={tx}
        onOpenChange={noop}
      />,
    );

    const dialog = screen.getByTestId('dashboard-customer-detail-dialog');
    expect(within(dialog).getByText('Total Unpaid: $1,250')).toBeInTheDocument();
    expect(within(dialog).getByText('Released')).toBeInTheDocument();
    expect(within(dialog).getByText('In Transit')).toBeInTheDocument();
    const historicalOrders = within(dialog).getByText('Historical Orders');
    const recentReceipts = within(dialog).getByText('Recent Receipts');
    expect(recentReceipts.compareDocumentPosition(historicalOrders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const sectionTitles = Array.from(dialog.querySelectorAll('[data-customer-detail-section]'))
      .map((node) => node.getAttribute('data-customer-detail-section'));
    expect(sectionTitles).toEqual(['released', 'in-transit', 'history']);
  });

  it('keeps outstanding visible and refuses to guess history for an unbound row', () => {
    render(
      <DashboardCustomerDetailDialog
        open
        customerId={null}
        title="UNKNOWN-01"
        outstanding={{ ...outstanding, customerId: null, customerKey: 'order:unknown' }}
        historyProps={{ ...historyProps, history: null }}
        unboundMessage="Customer history is unavailable because this order is not linked to a customer."
        tx={tx}
        onOpenChange={noop}
      />,
    );

    expect(screen.getByText('Total Unpaid: $1,250')).toBeInTheDocument();
    expect(screen.getByText('Customer history is unavailable because this order is not linked to a customer.')).toBeInTheDocument();
    expect(screen.queryByText('Historical Orders')).not.toBeInTheDocument();
  });
});
