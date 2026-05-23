import { fireEvent, render, screen } from '@testing-library/react';
import { DetailDirectCreateDialog } from './detail-direct-create-dialog';
import type { Receipt } from '@/lib/store';

const tx = (zh: string, _en: string) => zh;

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'receipt-1',
    receiptNo: '0001001',
    date: '2026-05-23',
    tel: null,
    usd: 250,
    invNo: 'INV-1',
    orderNo: 'PIKIN-20',
    payer: 'Mamadou Dian Diallo "PIKIN"',
    customerMark: 'PIKIN',
    customerName: 'Mamadou Dian Diallo',
    status: 'SR_Received',
    imageUrl: null,
    isDeposit: false,
    isMerged: false,
    note: null,
    createdAt: '2026-05-23T00:00:00.000Z',
    creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
    order: {
      id: 'order-1',
      orderNo: 'PIKIN-20',
      amount: 500,
      orderBalance: 250,
      customerMark: 'PIKIN',
      customerName: 'Mamadou Dian Diallo',
    },
    ...overrides,
  };
}

describe('DetailDirectCreateDialog', () => {
  it('lets users select readonly SR receipts and keeps the manual row entry available', () => {
    const onSelectedReceiptIdsChange = jest.fn();
    const onDirectItemsChange = jest.fn();

    render(
      <DetailDirectCreateDialog
        open
        locale="zh"
        directDate="2026-05-23"
        directItems={[{ mark: '', orderNo: '', amount: '' }]}
        selectableReceipts={[makeReceipt()]}
        selectedReceiptIds={[]}
        selectableReceiptsLoading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onDirectDateChange={jest.fn()}
        onDirectItemsChange={onDirectItemsChange}
        onSelectedReceiptIdsChange={onSelectedReceiptIdsChange}
        onSubmit={jest.fn()}
      />
    );

    expect(screen.getByText('可加入的收据')).toBeInTheDocument();
    expect(screen.getByText('PIKIN-20')).toBeInTheDocument();
    expect(screen.getByText('$250')).toBeInTheDocument();
    expect(screen.queryByText('0001001')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-05-23')).not.toBeInTheDocument();
    expect(screen.queryByText('Mamadou Dian Diallo "PIKIN"')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('单号')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择收据 0001001'));

    expect(onSelectedReceiptIdsChange).toHaveBeenCalledWith(['receipt-1']);
  });

  it('uses a bounded scroll area so many receipts do not push mobile footer actions off screen', () => {
    render(
      <DetailDirectCreateDialog
        open
        locale="zh"
        directDate="2026-05-23"
        directItems={[{ mark: '', orderNo: '', amount: '' }]}
        selectableReceipts={Array.from({ length: 12 }, (_, index) => makeReceipt({
          id: `receipt-${index}`,
          receiptNo: `00010${index}`,
          orderNo: `PIKIN-${index}`,
        }))}
        selectedReceiptIds={[]}
        selectableReceiptsLoading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onDirectDateChange={jest.fn()}
        onDirectItemsChange={jest.fn()}
        onSelectedReceiptIdsChange={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    expect(screen.getByTestId('direct-create-receipt-options')).toHaveClass('max-h-72', 'overflow-y-auto');
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument();
  });
});
