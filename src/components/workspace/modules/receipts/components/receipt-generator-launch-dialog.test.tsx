import { render, screen } from '@testing-library/react';
import { ReceiptGeneratorLaunchDialog } from './receipt-generator-launch-dialog';

describe('ReceiptGeneratorLaunchDialog', () => {
  const tx = (zh: string) => zh;

  const defaultProps = {
    open: true,
    orderNo: 'Big Alpha-07',
    usdAmount: '2500',
    paymentMode: 'Cash' as const,
    loadingContext: false,
    creatingSession: false,
    error: null,
    context: null,
    tx,
    onOpenChange: jest.fn(),
    onOrderNoChange: jest.fn(),
    onUsdAmountChange: jest.fn(),
    onPaymentModeChange: jest.fn(),
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
});
