import { render, screen } from '@testing-library/react';
import { ReceiptDirectImageConfirmDialog } from './receipt-direct-image-confirm-dialog';

describe('ReceiptDirectImageConfirmDialog', () => {
  const tx = (zh: string) => zh;

  it('shows a full-size preview confirmation step before upload', () => {
    render(
      <ReceiptDirectImageConfirmDialog
        selection={{
          file: new File(['receipt'], 'preview.jpg', { type: 'image/jpeg' }),
          previewUrl: 'data:image/jpeg;base64,mock',
          name: 'preview.jpg',
        }}
        tx={tx}
        uploading={false}
        uploadMessage={null}
        uploadProgress={null}
        onOpenChange={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '返回重选' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认上传' })).toBeInTheDocument();
    expect(screen.getByAltText('preview.jpg')).toBeInTheDocument();
  });

  it('keeps actions pinned and bounds preview height for portrait/mobile review', () => {
    render(
      <ReceiptDirectImageConfirmDialog
        selection={{
          file: new File(['receipt'], 'portrait.jpg', { type: 'image/jpeg' }),
          previewUrl: 'data:image/jpeg;base64,portrait',
          name: 'portrait.jpg',
        }}
        tx={tx}
        uploading={false}
        uploadMessage={null}
        uploadProgress={null}
        onOpenChange={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const header = screen.getByTestId('receipt-direct-image-confirm-header');
    const previewRegion = screen.getByTestId('receipt-direct-image-preview-region');
    const previewImage = screen.getByAltText('portrait.jpg');

    expect(header).toHaveClass('sticky', 'top-0', 'z-10');
    expect(previewRegion).toHaveClass('min-h-0', 'overflow-auto');
    expect(previewImage).toHaveClass('w-full', 'max-w-full', 'object-contain');
    expect(previewImage.className).toContain('max-h-');
  });
});
