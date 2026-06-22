import { fireEvent, render, screen } from '@testing-library/react';
import { ReceiptGeneratorLaunchDialog } from './receipt-generator-launch-dialog';

describe('ReceiptGeneratorLaunchDialog', () => {
  const tx = (zh: string) => zh;

  const defaultProps = {
    open: true,
    orderNo: 'Big Alpha-07',
    usdAmount: '2500',
    receiptNo: '0010000',
    paymentMode: 'Cash' as const,
    paymentType: 'Standard' as const,
    receivedBy: 'Mamadou Dian Diallo' as const,
    loadingContext: false,
    creatingSession: false,
    error: null,
    context: null,
    tx,
    onOpenChange: jest.fn(),
    onOrderNoChange: jest.fn(),
    onUsdAmountChange: jest.fn(),
    onReceiptNoChange: jest.fn(),
    onPaymentModeChange: jest.fn(),
    onPaymentTypeChange: jest.fn(),
    onReceivedByChange: jest.fn(),
    onSubmit: jest.fn(),
  };

  it('shows the customer label as COMPANY_NAME plus MARK when matched context includes company name', () => {
    render(
      <ReceiptGeneratorLaunchDialog
        {...defaultProps}
        context={{
          invNo: 'L25MH060523',
          customer: {
            id: 'cust-1',
            mark: 'Big Alpha',
            name: 'Alpha Oumar Diallo',
            companyName: 'Alpha Trading SARL',
            phone: '628 38 63 63',
            city: 'Conakry',
          },
          balanceBefore: 34660,
          preview: {
            balanceAfter: 32160,
          },
        } as any}
      />
    );

    expect(screen.getByText('Alpha Trading SARL "Big Alpha"')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Oumar Diallo "Big Alpha"')).not.toBeInTheDocument();
  });

  it('falls back to customer NAME plus MARK when company name is blank', () => {
    render(
      <ReceiptGeneratorLaunchDialog
        {...defaultProps}
        context={{
          invNo: 'L25MH060523',
          customer: {
            id: 'cust-1',
            mark: 'Big Alpha',
            name: 'Alpha Oumar Diallo',
            companyName: '',
            phone: '628 38 63 63',
            city: 'Conakry',
          },
          balanceBefore: 34660,
          preview: null,
        } as any}
      />
    );

    expect(screen.getByText('Alpha Oumar Diallo "Big Alpha"')).toBeInTheDocument();
  });

  it('shows the server-assigned receipt number preview as read-only before signing', () => {
    const onReceiptNoChange = jest.fn();

    render(
      <ReceiptGeneratorLaunchDialog
        {...defaultProps}
        onReceiptNoChange={onReceiptNoChange}
      />
    );

    const input = screen.getByLabelText('收据号');
    expect(input).toHaveValue('0010000');
    expect(input).toHaveAttribute('readonly');
    expect(onReceiptNoChange).not.toHaveBeenCalled();
    expect(screen.getByText('提交时由服务器原子分配，显示值仅作预览。')).toBeInTheDocument();
  });

  it('shows payment type and receiver selectors with the required defaults and options', () => {
    const onPaymentTypeChange = jest.fn();
    const onReceivedByChange = jest.fn();

    render(
      <ReceiptGeneratorLaunchDialog
        {...defaultProps}
        onPaymentTypeChange={onPaymentTypeChange}
        onReceivedByChange={onReceivedByChange}
      />
    );

    const paymentType = screen.getByLabelText('付款类型');
    expect(paymentType).toHaveValue('Standard');
    expect(screen.getByRole('option', { name: 'Deposit' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Full' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Initial' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Standard' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Final' })).toBeInTheDocument();

    fireEvent.change(paymentType, { target: { value: 'Deposit' } });
    expect(onPaymentTypeChange).toHaveBeenCalledWith('Deposit');

    const receivedBy = screen.getByLabelText('Reçu par');
    expect(receivedBy).toHaveValue('Mamadou Dian Diallo');
    fireEvent.change(receivedBy, { target: { value: 'Transferred via bank account' } });
    expect(onReceivedByChange).toHaveBeenCalledWith('Transferred via bank account');
  });

  it('keeps the form body scrollable and footer visible in constrained viewports', () => {
    render(<ReceiptGeneratorLaunchDialog {...defaultProps} />);

    expect(screen.getByRole('dialog')).toHaveClass('overflow-hidden', 'p-0');
    expect(screen.getByTestId('receipt-generator-scroll-body')).toHaveClass('overflow-y-auto', 'flex-1');
    expect(screen.getByTestId('receipt-generator-footer')).toHaveClass('shrink-0', 'border-t');
  });
});
