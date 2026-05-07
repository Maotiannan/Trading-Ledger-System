import { render, screen } from '@testing-library/react';
import { ReceiptUploadDialog } from './receipt-upload-dialog';

describe('ReceiptUploadDialog', () => {
  const tx = (zh: string) => zh;

  const defaultProps = {
    open: true,
    uploading: false,
    submitting: false,
    error: null,
    imagePreview: null,
    ocrResult: null,
    ocrCustomerMark: '',
    ocrCustomerId: '',
    ocrCustomerCandidates: [],
    ocrInvConflict: false,
    ocrInvConflictCount: 0,
    ocrUploadStatus: 'idle' as const,
    ocrUploadMessage: null,
    ocrUploadProgress: null,
    tx,
    onOpenChange: jest.fn(),
    onFileSelect: jest.fn(),
    onOcrResultChange: jest.fn(),
    onOcrCustomerMarkChange: jest.fn(),
    onOcrCustomerSelect: jest.fn(),
    onConfirm: jest.fn(),
  };

  it('renders OCR upload progress details while recognition upload is in flight', () => {
    render(
      <ReceiptUploadDialog
        {...defaultProps}
        uploading
        ocrUploadStatus="uploading"
        ocrUploadProgress={42}
        ocrUploadMessage="正在上传压缩后的图片（42%）..."
      />
    );

    expect(screen.getByText('正在上传压缩后的图片（42%）...')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="progress"]')).not.toBeNull();
  });

  it('keeps confirm disabled after a failed recognition attempt with no OCR result', () => {
    render(
      <ReceiptUploadDialog
        {...defaultProps}
        error="上传中断，请在更稳定的网络下重试"
        ocrUploadStatus="failed"
        ocrUploadMessage="上传中断，请在更稳定的网络下重试"
      />
    );

    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
  });

  it('recovers confirm availability once a retried recognition returns OCR data', () => {
    const { rerender } = render(
      <ReceiptUploadDialog
        {...defaultProps}
        error="AI识别失败，请重试"
        ocrUploadStatus="failed"
        ocrUploadMessage="AI识别失败，请重试"
      />
    );

    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();

    rerender(
      <ReceiptUploadDialog
        {...defaultProps}
        ocrResult={{ receiptNo: 'OCR-1', orderNo: 'TEST-1-05' }}
        ocrCustomerMark="ASD-DSA"
        ocrUploadStatus="success"
        ocrUploadMessage="AI识别完成"
        ocrUploadProgress={100}
      />
    );

    expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled();
  });

  it('uses a scrollable mobile-safe dialog shell with sticky actions', () => {
    render(
      <ReceiptUploadDialog
        {...defaultProps}
        ocrResult={{ receiptNo: 'OCR-1', orderNo: 'TEST-1-05' }}
        ocrCustomerMark="ASD-DSA"
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[90vh]');
    expect(screen.getByRole('button', { name: '确认创建' })).toBeInTheDocument();
  });

  it('leaves deposit unchecked by default when OCR does not explicitly mark deposit', () => {
    render(
      <ReceiptUploadDialog
        {...defaultProps}
        ocrResult={{ receiptNo: 'OCR-1', orderNo: 'AB-13B' }}
        ocrCustomerMark="AB"
      />
    );

    expect(screen.getByLabelText('这是定金 (DEPOSIT)')).not.toBeChecked();
  });
});
