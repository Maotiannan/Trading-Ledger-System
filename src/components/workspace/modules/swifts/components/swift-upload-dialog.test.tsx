import { render, screen } from '@testing-library/react';
import { SwiftUploadDialog } from './swift-upload-dialog';

jest.mock('@/components/workspace/modules/shared/pdf-preview', () => ({
  PdfPreview: ({ src, fileName }: { src: string; fileName?: string }) => (
    <div data-testid="pdf-preview" data-src={src}>{fileName}</div>
  ),
}));

describe('SwiftUploadDialog', () => {
  const tx = (zh: string) => zh;
  const defaultProps = {
    open: true,
    waitingDetails: [],
    waitingDetailsLoading: false,
    uploading: false,
    submitting: false,
    selectedDetailId: '',
    error: null,
    imagePreview: null,
    ocrResult: null,
    ocrUploadStatus: 'idle' as const,
    ocrUploadMessage: null,
    ocrUploadProgress: null,
    tx,
    onOpenChange: jest.fn(),
    onSelectedDetailIdChange: jest.fn(),
    onFileSelect: jest.fn(),
    onOcrResultChange: jest.fn(),
    onConfirm: jest.fn(),
  };

  it('accepts PDF files for SWIFT OCR upload', () => {
    render(<SwiftUploadDialog {...defaultProps} />);

    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/*,application/pdf');
  });

  it('renders a PDF preview surface instead of a static file card for PDF uploads', () => {
    const { container } = render(
      <SwiftUploadDialog
        {...defaultProps}
        imagePreview={`data:application/pdf;base64,${Buffer.from('%PDF-1.5\n').toString('base64')}`}
      />
    );

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
