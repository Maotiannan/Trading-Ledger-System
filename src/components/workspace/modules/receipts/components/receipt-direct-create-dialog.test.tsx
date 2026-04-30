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
    directUploadStatus: 'idle' as const,
    directUploadMessage: null,
    directUploadProgress: null,
    invConflict: false,
    invConflictCount: 0,
    onOpenChange: jest.fn(),
    onFormChange: jest.fn(),
    onCustomerMarkChange: jest.fn(),
    onCustomerSelect: jest.fn(),
    onSubmit: jest.fn(),
    onImageSelect: jest.fn(),
  };

  it('shows upload button and keeps requested input order', () => {
    render(<ReceiptDirectCreateDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: '拍照' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '从相册选择' })).toBeInTheDocument();

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

  it('renders upload error text when direct upload fails', () => {
    render(<ReceiptDirectCreateDialog {...defaultProps} directUploadStatus="failed" directUploadMessage="上传中断，请在更稳定的网络下重试" />);

    expect(screen.getByText('上传中断，请在更稳定的网络下重试')).toBeInTheDocument();
  });

  it('renders upload progress when direct upload is in flight', () => {
    render(<ReceiptDirectCreateDialog {...defaultProps} directUploadStatus="uploading" directUploadProgress={42} directUploadMessage="正在上传图片（42%）..." />);

    expect(screen.getByText('正在上传图片（42%）...')).toBeInTheDocument();
    expect(document.querySelector('[data-slot=\"progress\"]')).not.toBeNull();
  });
});
