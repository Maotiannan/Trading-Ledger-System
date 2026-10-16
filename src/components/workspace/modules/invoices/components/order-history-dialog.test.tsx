import { fireEvent, render, screen } from '@testing-library/react';
import { OrderHistoryDialog } from './order-history-dialog';

const tx = (_zh: string, en: string) => en;

describe('OrderHistoryDialog', () => {
  it('shows payer and opens a receipt image from the receipt number', () => {
    const onOpenReceiptImage = jest.fn();

    render(
      <OrderHistoryDialog
        open
        title="AB-01"
        tx={tx}
        rows={[{
          id: 'receipt-1',
          receiptNo: '0010001',
          payer: 'Alice',
          usd: 250,
          status: 'RECEIVED',
          date: '2026-08-01',
          createdAt: '2026-08-02T08:00:00.000Z',
          imageUrl: '/upload/receipt.png',
        }]}
        onOpenChange={() => undefined}
        onOpenReceiptImage={onOpenReceiptImage}
      />,
    );

    expect(screen.getByText('Payer')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '0010001' }));
    expect(onOpenReceiptImage).toHaveBeenCalledWith(expect.objectContaining({
      receiptNo: '0010001',
      payer: 'Alice',
    }));
  });

  it('opens the shared receipt preview without a parent callback', () => {
    render(
      <OrderHistoryDialog
        open
        title="AB-01"
        tx={tx}
        rows={[{
          id: 'receipt-2',
          receiptNo: '0010002',
          payer: 'Bob',
          usd: 100,
          status: 'RECEIVED',
          date: '2026-08-03',
          createdAt: '2026-08-03T08:00:00.000Z',
          imageUrl: '/upload/receipt-2.png',
        }]}
        onOpenChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '0010002' }));
    expect(screen.getByAltText('Receipt image')).toBeInTheDocument();
  });
});
