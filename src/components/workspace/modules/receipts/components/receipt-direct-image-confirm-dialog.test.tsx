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
});
