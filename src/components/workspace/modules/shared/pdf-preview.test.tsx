import { isPdfPreviewSource } from './pdf-preview';

describe('pdf-preview', () => {
  it('detects PDF sources from data URLs, filenames, and encoded upload URLs', () => {
    expect(isPdfPreviewSource('data:application/pdf;base64,JVBERi0=', null)).toBe(true);
    expect(isPdfPreviewSource('/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.pdf', null)).toBe(true);
    expect(isPdfPreviewSource('/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fasset', 'swift.PDF')).toBe(true);
  });

  it('does not classify normal image sources as PDFs', () => {
    expect(isPdfPreviewSource('data:image/jpeg;base64,abc', null)).toBe(false);
    expect(isPdfPreviewSource('/api/upload-image?path=%2Fupload%2Fimages%2Fswifts%2Focr%2Fswift.jpg', 'swift.jpg')).toBe(false);
  });
});
