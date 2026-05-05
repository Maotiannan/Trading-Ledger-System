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
      />,
    );

    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
  });
});
