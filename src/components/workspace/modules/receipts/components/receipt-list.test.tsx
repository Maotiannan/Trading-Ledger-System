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
        currentUserId="admin-1"
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

  it('uses the shared compact pagination layout at the bottom', () => {
    render(
      <ReceiptList
        receipts={Array.from({ length: 21 }, (_, index) => ({
          ...baseReceipt,
          id: `receipt-${index}`,
          receiptNo: `0001${String(index).padStart(3, '0')}`,
        }))}
        paginatedReceipts={[baseReceipt]}
        currentPage={1}
        totalPages={2}
        isAdmin
        currentUserId="admin-1"
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
        pageSize={20}
        pageSizeOptions={[5, 10, 20, 50]}
        onPageSizeChange={() => undefined}
      />,
    );

    expect(screen.getByLabelText('每页条数')).toHaveValue('20');
    expect(screen.getByRole('button', { name: '上一页' })).toHaveTextContent('←');
    expect(screen.getByRole('button', { name: '下一页' })).toHaveTextContent('→');
    expect(screen.getByText('1 / 2 (21)')).toBeInTheDocument();
    expect(screen.getByTestId('list-pagination-content')).toHaveClass('flex-row', 'flex-nowrap');
  });

  it('hides RECEIVED edit/delete actions from sales users and keeps them visible for admins', () => {
    const { rerender } = render(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'RECEIVED' }]}
        currentPage={1}
        totalPages={1}
        isAdmin={false}
        currentUserId="sales-1"
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
        currentUserId="admin-1"
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

  it('shows deletion request action for SIGNING_PENDING receipts to admins and creators only', () => {
    const { rerender } = render(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        currentPage={1}
        totalPages={1}
        isAdmin={false}
        currentUserId="sales-1"
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

    rerender(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        currentPage={1}
        totalPages={1}
        isAdmin={false}
        currentUserId="other-user"
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

    expect(screen.queryByTitle('申请删除')).not.toBeInTheDocument();

    rerender(
      <ReceiptList
        receipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        paginatedReceipts={[{ ...baseReceipt, status: 'SIGNING_PENDING', creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' } }]}
        currentPage={1}
        totalPages={1}
        isAdmin
        currentUserId="admin-1"
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

    expect(screen.getByTitle('申请删除')).toBeInTheDocument();
  });
});
