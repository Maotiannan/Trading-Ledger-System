import { render, screen, within } from '@testing-library/react';
import { CreateInvoiceDialog } from './create-invoice-dialog';

describe('CreateInvoiceDialog', () => {
  const tx = (zh: string) => zh;

  it('keeps add order, cancel, and create actions together at the bottom', () => {
    render(
      <CreateInvoiceDialog
        open
        submitting={false}
        formError=""
        invNo="INV-1"
        shipDate=""
        releaseDate=""
        orders={[{ orderNo: 'MAB-1-01', amount: '100', customerMark: 'MAB', customerName: 'Mamadou', customerId: '', customerCandidates: [] }]}
        tx={tx}
        onOpenChange={() => undefined}
        onInvNoChange={() => undefined}
        onShipDateChange={() => undefined}
        onReleaseDateChange={() => undefined}
        onOrderChange={() => undefined}
        onOrderCustomerSelect={() => undefined}
        onAddOrderRow={() => undefined}
        onRemoveOrder={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    const footer = screen.getByTestId('invoice-create-footer-actions');
    expect(within(footer).getByRole('button', { name: '添加订单' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: '创建' })).toBeInTheDocument();
    expect(footer).not.toHaveClass('sticky');
  });
});
