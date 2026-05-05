import { buildDetailExportSvg, renderDetailExportPng } from '@/lib/detail-export-image';
import type { Detail } from '@/lib/store';

const detail: Detail = {
  id: 'detail-1',
  date: '2026-05-05T00:00:00.000Z',
  status: 'Waiting_SWIFT',
  sourceMode: 'DIRECT',
  imageUrl: null,
  imageName: null,
  totalAmount: 20003,
  createdAt: '2026-05-05T00:00:00.000Z',
  creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
  items: [
    { id: 'item-1', mark: 'Simagan', orderNo: 'Simagan-07', amount: 5277, receiptId: null },
    { id: 'item-2', mark: 'Sabou', orderNo: 'Sabou-01', amount: 3003, receiptId: null },
  ],
};

describe('detail-export-image', () => {
  it('builds svg content using numbered payment rows', () => {
    const svg = buildDetailExportSvg(detail);

    expect(svg).toContain('Payment details for $8,280');
    expect(svg).toContain('Simagan');
    expect(svg).toContain('Payment for Simagan-07');
    expect(svg).toContain('Total amount transferred $8,280#');
  });

  it('renders a png buffer from the svg layout', async () => {
    const png = await renderDetailExportPng(detail);

    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
  });
});
