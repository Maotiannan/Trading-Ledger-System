import { toOcrDataUrl } from '@/lib/ocr-input';

describe('ocr-input', () => {
  it('passes PDF files through as application/pdf data URLs for multi-page AI OCR', async () => {
    const pdfBytes = Buffer.from('%PDF-1.5\n1 0 obj\n<<>>\nendobj\n');
    const file = {
      name: 'swift.pdf',
      type: 'application/pdf',
      size: pdfBytes.byteLength,
      arrayBuffer: async () => pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ),
    } as File;

    const result = await toOcrDataUrl(file);

    expect(result).toBe(`data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`);
  });
});
