import { render, screen } from '@testing-library/react';
import { ReceiptDirectCreateDialog } from './receipt-direct-create-dialog';

describe('ReceiptDirectCreateDialog', () => {
  const tx = (zh: string) => zh;

  const defaultProps = {
    open: true,
    locale: 'zh',
    form: {
      receiptNo: '',
      date: '2026-04-27',
      tel: '',
      usd: '',
      invNo: '',
      orderNo: '',
      payer: '',
      customerMark: '',
      customerName: '',
      customerId: '',
      isDeposit: false,
    },
    customerCandidates: [],
    tx,
    uploadedImageName: '',
    directUploading: false,
    onOpenChange: jest.fn(),
    onFormChange: jest.fn(),
    onCustomerMarkChange: jest.fn(),
    onCustomerSelect: jest.fn(),
    onSubmit: jest.fn(),
    onImageSelect: jest.fn(),
  };

  it('shows upload button and keeps requested input order', () => {
    render(<ReceiptDirectCreateDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: '上传图片' })).toBeInTheDocument();

    const orderNoInput = screen.getByPlaceholderText('客户单号(orderNo)');
    const invNoInput = screen.getByPlaceholderText('账单号(invNo)');
    const customerMarkInput = screen.getByPlaceholderText('客户MARK(必填)');
    const usdInput = screen.getByPlaceholderText('付款金额(USD)');

    const placeholders = Array.from(document.querySelectorAll('input'))
      .map((node) => node.getAttribute('placeholder'))
      .filter(Boolean);

    expect(placeholders.indexOf('客户单号(orderNo)')).toBeLessThan(placeholders.indexOf('账单号(invNo)'));
    expect(placeholders.indexOf('账单号(invNo)')).toBeLessThan(placeholders.indexOf('客户MARK(必填)'));
    expect(placeholders.indexOf('客户MARK(必填)')).toBeLessThan(placeholders.indexOf('付款金额(USD)'));

    expect(orderNoInput.compareDocumentPosition(invNoInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(invNoInput.compareDocumentPosition(customerMarkInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(customerMarkInput.compareDocumentPosition(usdInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
