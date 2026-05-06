import sharp from 'sharp';
import {
  buildDetailExportSvg,
  getDetailExportFontPaths,
  renderDetailExportJpeg,
  type DetailExportViewModel,
} from '@/lib/detail-export-image';

const viewModel: DetailExportViewModel = {
  dateLabel: '05 / 05 / 2026',
  totalAmount: 101326,
  transactionCount: 20,
  footerAgentLabel: 'Mitty Group',
  rows: [
    { index: 1, mark: 'Simagan', orderNo: 'Simagan-07', type: 'Final', amount: 5277 },
    { index: 2, mark: 'Sabou', orderNo: 'Sabou-01', type: 'Final', amount: 3003 },
    { index: 6, mark: 'THP', orderNo: 'THP-04', type: 'Initial', amount: 3070 },
    { index: 7, mark: 'AMD', orderNo: 'AMD-05', type: 'Std', amount: 3000 },
  ],
};

describe('detail-export-image', () => {
  it('builds svg content using the payment details export layout', () => {
    const svg = buildDetailExportSvg(viewModel);

    expect(svg).toContain('TOTAL');
    expect(svg).toContain('TRANSACTIONS');
    expect(svg).toContain('ORDER NO');
    expect(svg).toContain('Simagan');
    expect(svg).toContain('Simagan-07');
    expect(svg).toContain('Final');
    expect(svg).toContain('Initial');
    expect(svg).toContain('TOTAL TRANSFERRED');
    expect(svg).toContain('Mitty Group · Disbursement');
    expect(svg).toContain('20 records');
    expect(svg).toContain('data:image/png;base64,');
  });

  it('renders a readable jpeg buffer from the export layout', async () => {
    const jpeg = await renderDetailExportJpeg(viewModel);
    const metadata = await sharp(jpeg).metadata();

    expect(Buffer.isBuffer(jpeg)).toBe(true);
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(metadata.width).toBe(720);
    expect((metadata.height ?? 0) > 0).toBe(true);
  });

  it('keeps the export layout readable on portrait mobile screens', () => {
    const svg = buildDetailExportSvg(viewModel);

    expect(svg).toContain('width="720"');
    expect(svg).toContain('font-size="15" font-weight="700" fill="#000000">Simagan');
    expect(svg).toContain('font-size="24" font-weight="700" fill="#415cc3">$101,326</text>');
  });

  it('uses bundled Arial font files for deterministic server rendering', () => {
    const fontPaths = getDetailExportFontPaths();

    expect(fontPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/arial\.ttf$/),
      expect.stringMatching(/arial-bold\.ttf$/),
    ]));
  });
});
