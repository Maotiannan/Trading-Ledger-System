import { fireEvent, render, screen } from '@testing-library/react';
import { DetailDirectCreateDialog } from './detail-direct-create-dialog';
import type { Receipt } from '@/lib/store';
import type { PaymentAgentSummary } from '../types';

const tx = (zh: string, _en: string) => zh;

const agents: PaymentAgentSummary[] = [
  {
    id: 'agent-1',
    companyName: 'Mitty Group',
    companyAddress: null,
    contactName: null,
    contactPhone: null,
    createdBy: 'admin-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    files: [],
  },
  {
    id: 'agent-2',
    companyName: 'Second Agent',
    companyAddress: null,
    contactName: null,
    contactPhone: null,
    createdBy: 'admin-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    files: [],
  },
];

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
        agents={agents}
        agentsLoading={false}
        selectedAgentId=""
        selectableReceipts={[makeReceipt()]}
        selectedReceiptIds={[]}
        selectableReceiptsLoading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onDirectDateChange={jest.fn()}
        onDirectItemsChange={onDirectItemsChange}
        onSelectedAgentIdChange={jest.fn()}
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
    expect(screen.queryByPlaceholderText('单号')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开手动明细' }));

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
        agents={agents}
        agentsLoading={false}
        selectedAgentId="agent-1"
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
        onSelectedAgentIdChange={jest.fn()}
        onSelectedReceiptIdsChange={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    expect(screen.getByTestId('direct-create-receipt-options')).toHaveClass('max-h-72', 'overflow-y-auto');
    expect(screen.getByTestId('direct-create-footer')).toHaveClass('sticky', 'bottom-0');
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument();
  });

  it('shows the total amount for selected receipts and manual rows near the footer', () => {
    render(
      <DetailDirectCreateDialog
        open
        locale="zh"
        directDate="2026-05-23"
        directItems={[
          { mark: 'AMD', orderNo: 'AMD-01', amount: '1000' },
          { mark: 'IBS', orderNo: 'IBS-01', amount: '$250.49' },
        ]}
        agents={agents}
        agentsLoading={false}
        selectedAgentId="agent-1"
        selectableReceipts={[
          makeReceipt({ id: 'receipt-1', receiptNo: '0001001', usd: 250 }),
          makeReceipt({ id: 'receipt-2', receiptNo: '0001002', usd: 500 }),
        ]}
        selectedReceiptIds={['receipt-1', 'receipt-2']}
        selectableReceiptsLoading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onDirectDateChange={jest.fn()}
        onDirectItemsChange={jest.fn()}
        onSelectedAgentIdChange={jest.fn()}
        onSelectedReceiptIdsChange={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    expect(screen.getByText('总计')).toBeInTheDocument();
    expect(screen.getByTestId('direct-create-total-amount')).toHaveTextContent('$2,000');
  });

  it('lets users choose a payment agent before the receipt section', () => {
    const onSelectedAgentIdChange = jest.fn();

    render(
      <DetailDirectCreateDialog
        open
        locale="zh"
        directDate="2026-05-23"
        directItems={[{ mark: '', orderNo: '', amount: '' }]}
        agents={agents}
        agentsLoading={false}
        selectedAgentId=""
        selectableReceipts={[]}
        selectedReceiptIds={[]}
        selectableReceiptsLoading={false}
        tx={tx}
        onOpenChange={jest.fn()}
        onDirectDateChange={jest.fn()}
        onDirectItemsChange={jest.fn()}
        onSelectedAgentIdChange={onSelectedAgentIdChange}
        onSelectedReceiptIdsChange={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    const agentSelect = screen.getByLabelText('付款代理');
    expect(agentSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mitty Group' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Second Agent' })).toBeInTheDocument();

    fireEvent.change(agentSelect, { target: { value: 'agent-2' } });

    expect(onSelectedAgentIdChange).toHaveBeenCalledWith('agent-2');
  });
});
