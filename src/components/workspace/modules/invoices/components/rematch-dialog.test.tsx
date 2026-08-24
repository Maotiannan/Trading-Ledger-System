import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { RematchDialog } from './rematch-dialog';

const tx = (_zh: string, en: string) => en;

const poolRepairs = [
  {
    sourceOrderId: 'auto',
    orderNo: 'AB-12',
    sourcePool: 'DEPOSIT_POOL' as const,
    amount: 10000,
    orderBalance: 8000,
    receiptCount: 1,
    repairMode: 'AUTO' as const,
    targetOrderId: 'formal-1',
    targetInvoiceId: 'invoice-1',
    targetInvNo: 'INV-001',
  },
  {
    sourceOrderId: 'manual',
    orderNo: 'AB-13B',
    sourcePool: 'DEPOSIT_POOL' as const,
    amount: 18000,
    orderBalance: 14000,
    receiptCount: 1,
    repairMode: 'MANUAL' as const,
    targetOrderId: null,
    targetInvoiceId: null,
    targetInvNo: null,
  },
];

function StatefulDialog({ onApply = jest.fn() }: { onApply?: jest.Mock }) {
  const [poolSelections, setPoolSelections] = useState<Record<string, string>>({});
  return (
    <RematchDialog
      open
      groups={[]}
      poolRepairs={poolRepairs}
      targetInvoices={[
        { id: 'invoice-1', invNo: 'INV-001' },
        { id: 'invoice-2', invNo: 'INV-002' },
      ]}
      poolSelections={poolSelections}
      selections={{}}
      applying={false}
      tx={tx}
      onOpenChange={() => undefined}
      onSelectionChange={() => undefined}
      onPoolSelectionChange={(sourceOrderId, targetInvoiceId) => {
        setPoolSelections((previous) => ({ ...previous, [sourceOrderId]: targetInvoiceId }));
      }}
      onApply={onApply}
    />
  );
}

describe('RematchDialog system-pool repairs', () => {
  it('requires every manual target while showing automatic repairs read-only', () => {
    render(<StatefulDialog />);

    expect(screen.getByText('System Pool Repairs')).toBeInTheDocument();
    expect(screen.getByText('Will move automatically')).toBeInTheDocument();
    expect(screen.getAllByText('INV-001').length).toBeGreaterThan(0);

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(applyButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Target invoice for AB-13B'), {
      target: { value: 'invoice-2' },
    });

    expect(applyButton).toBeEnabled();
  });

  it('keeps the mobile-safe scroll body separate from the footer', () => {
    render(<StatefulDialog />);

    expect(screen.getByRole('dialog')).toHaveClass(
      'max-h-[calc(100vh-24px)]',
      'w-[calc(100vw-24px)]',
      'flex-col',
    );
    expect(screen.getByTestId('rematch-scroll-body')).toHaveClass(
      'min-h-0',
      'flex-1',
      'overflow-y-auto',
    );
    expect(screen.getByTestId('rematch-dialog-footer')).toBeInTheDocument();
  });
});
