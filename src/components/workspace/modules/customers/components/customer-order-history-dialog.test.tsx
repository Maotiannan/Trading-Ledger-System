import { render, screen } from '@testing-library/react';
import { CustomerOrderHistoryDialog } from './customer-order-history-dialog';

describe('CustomerOrderHistoryDialog', () => {
  const tx = (zh: string) => zh;

  it('shows order history and recent receipts in a desktop two-column layout', () => {
    render(
      <CustomerOrderHistoryDialog
        open
        loading={false}
        error=""
        title="MAB-1"
        tx={tx}
        history={{
          orders: [{
            id: 'order-1',
            orderNo: 'MAB-1-10',
            invNo: 'L25MH090001',
            amount: 1000,
            outstanding: 250,
          }],
          receipts: [{
            id: 'receipt-1',
            receiptNo: '0001001',
            orderNo: 'MAB-1-10',
            invNo: 'L25MH090001',
            usd: 750,
            status: 'RECEIVED',
            date: '2026-05-07',
          }],
        }}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('customer-order-history-grid')).toHaveClass('md:grid-cols-2');
    expect(screen.getAllByText('MAB-1-10')).toHaveLength(2);
    expect(screen.getByText('L25MH090001')).toBeInTheDocument();
    expect(screen.getByText('$1,000')).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
    expect(screen.getByText('0001001')).toBeInTheDocument();
    expect(screen.getByText('RECEIVED')).toBeInTheDocument();
  });
});
