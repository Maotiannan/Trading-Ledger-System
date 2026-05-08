import { render, screen } from '@testing-library/react';
import { SwiftImagePreviewDialog } from './swift-image-preview-dialog';

jest.mock('@/components/workspace/modules/shared/pdf-preview', () => ({
  PdfPreview: ({ src, fileName }: { src: string; fileName?: string }) => (
    <div data-testid="pdf-preview" data-src={src}>{fileName}</div>
  ),
  isPdfPreviewSource: (src: string | null | undefined, fileName?: string | null) => {
    const raw = `${src || ''} ${fileName || ''}`.toLowerCase();
    return raw.startsWith('data:application/pdf') || raw.includes('.pdf');
  },
}));

describe('SwiftImagePreviewDialog', () => {
  it('renders existing image assets with the original image preview path', () => {
    render(
      <SwiftImagePreviewDialog
        image={{ url: '/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.jpg', name: 'swift.jpg' }}
        onOpenChange={jest.fn()}
      />,
    );

    const image = screen.getByRole('img', { name: 'swift.jpg' });
    expect(image).toHaveAttribute('src', '/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.jpg');
    expect(image).toHaveAttribute('alt', 'swift.jpg');
  });

  it('renders existing PDF assets with the PDF preview surface instead of an image tag', () => {
    const { container } = render(
      <SwiftImagePreviewDialog
        image={{ url: '/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.pdf', name: 'swift.pdf' }}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pdf-preview')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps long PDF filenames inside the mobile preview dialog', () => {
    const longName = 'Swift_Super_DT2_30_040_FirstBank_06-05-2026_with_a_very_long_mobile_filename.pdf';

    render(
      <SwiftImagePreviewDialog
        image={{ url: '/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.pdf', name: longName }}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getAllByText(longName)[0]).toHaveClass('break-all');
    expect(screen.getByTestId('pdf-preview').parentElement).toHaveClass('overflow-hidden');
  });
});
