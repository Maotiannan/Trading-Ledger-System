import { fireEvent, render, screen, within } from '@testing-library/react';
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
          orderPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          orders: [{
            id: 'order-1',
            orderNo: 'BIG ALPHA-10A/BIG ALPHA-10B',
            invNo: 'L25MH090001',
            amount: 1000,
            outstanding: 250,
          }],
          receiptPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          receipts: [{
            id: 'receipt-1',
            receiptNo: '0001001',
            orderNo: 'BIG ALPHA-10A/BIG ALPHA-10B',
            invNo: 'L25MH090001',
            usd: 750,
            status: 'RECEIVED',
            date: '2026-05-07',
            createdAt: '2026-05-08T10:12:30.000Z',
          }],
        }}

        orderPageSizeOptions={[5, 10, 15, 20]}
        receiptPageSizeOptions={[5, 10, 15, 20]}
        onOrderPreviousPage={() => undefined}
        onOrderNextPage={() => undefined}
        onOrderPageSizeChange={() => undefined}
        onReceiptPreviousPage={() => undefined}
        onReceiptNextPage={() => undefined}
        onReceiptPageSizeChange={() => undefined}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveClass('md:w-fit', 'md:max-w-[calc(100vw-32px)]');
    expect(screen.getByTestId('customer-order-history-scroll')).toHaveClass('md:overflow-x-auto');
    expect(screen.getByTestId('customer-order-history-grid')).toHaveClass(
      'md:w-max',
      'md:grid-cols-[max-content_max-content]',
      'md:items-start',
    );

    const ordersTable = screen.getByTestId('customer-order-history-orders-table');
    const receiptsTable = screen.getByTestId('customer-order-history-receipts-table');
    expect(within(ordersTable).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'ORDER',
      'INV NO',
      'AMOUNT',
      'O/S',
    ]);
    expect(within(receiptsTable).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '创建时间',
      'ORDER',
      'USD',
      'Status',
      'Receipt',
    ]);

    const orderCells = screen.getAllByTestId('customer-order-history-order-value');
    expect(orderCells).toHaveLength(2);
    for (const cell of orderCells) {
      expect(cell).toHaveClass('min-w-[13ch]');
      expect(cell).not.toHaveClass('break-words');
      expect(cell.textContent).toBe('BIG ALPHA-10A/BIG ALPHA-10B');
      expect(cell.querySelectorAll('wbr')).toHaveLength(1);
    }

    expect(within(ordersTable).getByText('L25MH090001').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(ordersTable).getByText('$1,000').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(ordersTable).getByText('$250').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(receiptsTable).getByText('$750').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(receiptsTable).getByText('RECEIVED').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(receiptsTable).getByText('0001001').closest('td')).toHaveClass('whitespace-nowrap');
    expect(within(receiptsTable).getByText('08/05/2026').closest('td')).toHaveClass('whitespace-nowrap');

    expect(screen.getByText('$1,000')).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
    expect(screen.getByText('0001001')).toBeInTheDocument();
    expect(screen.getByText('RECEIVED')).toBeInTheDocument();
  });

  it('keeps the existing tables visible while a pagination refresh is loading', () => {
    render(
      <CustomerOrderHistoryDialog
        open
        loading
        error=""
        title="MAB-1"
        tx={tx}
        history={{
          orderPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          orders: [{
            id: 'order-1',
            orderNo: 'MAB-1-10',
            invNo: 'L25MH090001',
            amount: 1000,
            outstanding: 250,
          }],
          receiptPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          receipts: [{
            id: 'receipt-1',
            receiptNo: '0001001',
            orderNo: 'MAB-1-10',
            invNo: 'L25MH090001',
            usd: 750,
            status: 'RECEIVED',
            date: '2026-05-07',
            createdAt: '2026-05-08T10:12:30.000Z',
          }],
        }}
        orderPageSizeOptions={[5, 10, 15, 20]}
        receiptPageSizeOptions={[5, 10, 15, 20]}
        onOrderPreviousPage={() => undefined}
        onOrderNextPage={() => undefined}
        onOrderPageSizeChange={() => undefined}
        onReceiptPreviousPage={() => undefined}
        onReceiptNextPage={() => undefined}
        onReceiptPageSizeChange={() => undefined}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('customer-order-history-orders-table')).toBeInTheDocument();
    expect(screen.getByTestId('customer-order-history-receipts-table')).toBeInTheDocument();
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
  });

  it('describes combined ORDER_NAME history and opens an attached receipt image', () => {
    const onOpenReceiptImage = jest.fn();
    render(
      <CustomerOrderHistoryDialog
        open
        loading={false}
        error=""
        title="MAB-1 / MARY"
        allOrderNames
        tx={tx}
        history={{
          orderPagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
          orders: [],
          receiptPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
          receipts: [{
            id: 'receipt-1',
            receiptNo: '0010001',
            orderNo: 'MARY-01',
            invNo: 'INV-2',
            boundInvNo: 'INV-2',
            usd: 400,
            status: 'RECEIVED',
            date: '2026-07-01',
            createdAt: '2026-07-02T08:00:00.000Z',
            imageUrl: '/upload/images/receipts/ocr/mary.jpg',
            imageName: 'mary.jpg',
            creatorName: 'User',
            creatorEmail: 'user@example.com',
          }],
        }}
        orderPageSizeOptions={[5, 10, 15, 20]}
        receiptPageSizeOptions={[5, 10, 15, 20]}
        onOrderPreviousPage={() => undefined}
        onOrderNextPage={() => undefined}
        onOrderPageSizeChange={() => undefined}
        onReceiptPreviousPage={() => undefined}
        onReceiptNextPage={() => undefined}
        onReceiptPageSizeChange={() => undefined}
        onOpenReceiptImage={onOpenReceiptImage}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByText('查看该客户所有 ORDER_NAME 的历史订单，以及最近收据状态。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '0010001' }));
    expect(onOpenReceiptImage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'receipt-1',
      imageUrl: '/upload/images/receipts/ocr/mary.jpg',
    }));
  });
});
