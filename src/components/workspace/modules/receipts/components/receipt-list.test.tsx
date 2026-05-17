import { render, screen } from '@testing-library/react';
import { ReceiptList } from './receipt-list';
import type { Receipt } from '@/lib/store';

describe('ReceiptList', () => {
  const tx = (zh: string) => zh;
  const baseReceipt: Receipt = {
    id: 'receipt-1',
    receiptNo: '0001001',
    date: '2026-05-05',
    tel: '620000000',
    usd: 100,
    invNo: 'INV-1',
    orderNo: 'ORDER-1',
    payer: 'Payer',
    customerMark: 'MAB-1',
    customerName: 'MAB',
    customerPhone: '620000000',
    customerCity: 'Conakry',
    needsCustomerFix: false,
    status: 'SR_Received',
    imageUrl: null,
    isDeposit: false,
    isMerged: false,
    note: null,
    createdAt: '2026-05-05T00:00:00.000Z',
    creator: { id: 'user-1', name: 'User', email: 'user@example.com' },
    order: null,
  };

  it('renders computed balance values and fallback dash when unavailable', () => {
    render(
      <ReceiptList
        receipts={[
          { ...baseReceipt, id: 'receipt-1', balanceAfter: 350 },
          { ...baseReceipt, id: 'receipt-2', receiptNo: '0001002', balanceAfter: null },
        ]}
        paginatedReceipts={[
          { ...baseReceipt, id: 'receipt-1', balanceAfter: 350 },
          { ...baseReceipt, id: 'receipt-2', receiptNo: '0001002', balanceAfter: null },
        ]}
        currentPage={1}
        totalPages={1}
        isAdmin
        canEdit
        canResumeSigning
        tx={tx}
        getStatusBadge={(status) => <span>{status}</span>}
        onViewImage={() => undefined}
        onEditReceipt={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteReceipt={() => undefined}
        onResumeSigning={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
        pageSize={30}
        pageSizeOptions={[30, 50, 100, 200]}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByText('$350')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });

  it('shows rows-per-page control next to bottom pagination controls', () => {
    render(
      <ReceiptList
        receipts={Array.from({ length: 31 }, (_, index) => ({
          ...baseReceipt,
          id: `receipt-${index}`,
          receiptNo: `0001${String(index).padStart(3, '0')}`,
        }))}
        paginatedReceipts={[baseReceipt]}
        currentPage={1}
        totalPages={2}
        isAdmin
        canEdit
        canResumeSigning
        tx={tx}
        getStatusBadge={(status) => <span>{status}</span>}
        onViewImage={() => undefined}
        onEditReceipt={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteReceipt={() => undefined}
        onResumeSigning={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
        pageSize={30}
        pageSizeOptions={[30, 50, 100, 200]}
        onPageSizeChange={() => undefined}
      />,
    );

    const pagination = screen.getByTestId('receipt-pagination-controls');
    expect(pagination).toContainElement(screen.getByLabelText('每页条数'));
  });

  it('hides RECEIVED edit/delete actions from sales users and keeps them visible for admins', () => {
    const { rerender } = render(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        currentPage={1}
        totalPages={1}
        isAdmin={false}
        canEdit
        canResumeSigning
        tx={tx}
        getStatusBadge={(status) => <span>{status}</span>}
        onViewImage={() => undefined}
        onEditReceipt={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteReceipt={() => undefined}
        onResumeSigning={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
        pageSize={30}
        pageSizeOptions={[30, 50, 100, 200]}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.queryByTitle('修改收据')).not.toBeInTheDocument();
    expect(screen.queryByTitle('申请删除')).not.toBeInTheDocument();

    rerender(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        currentPage={1}
        totalPages={1}
        isAdmin
        canEdit
        canResumeSigning
        tx={tx}
        getStatusBadge={(status) => <span>{status}</span>}
        onViewImage={() => undefined}
        onEditReceipt={() => undefined}
        onMarkReceived={() => undefined}
        onDeleteReceipt={() => undefined}
        onResumeSigning={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
        pageSize={30}
        pageSizeOptions={[30, 50, 100, 200]}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByTitle('修改收据')).toBeInTheDocument();
    expect(screen.getByTitle('申请删除')).toBeInTheDocument();
  });
});
