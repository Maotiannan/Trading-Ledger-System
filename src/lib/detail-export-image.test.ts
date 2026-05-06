import sharp from 'sharp';
import { buildDetailExportSvg, renderDetailExportJpeg } from '@/lib/detail-export-image';
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
    {
      id: 'item-1',
      mark: 'Simagan',
      orderNo: 'Simagan-07',
      amount: 5277,
      receiptId: null,
      receipt: {
        id: 'receipt-1',
        receiptNo: 'RCPT-1',
        date: '2026-05-05T00:00:00.000Z',
        tel: null,
        usd: 5277,
        invNo: 'INV-1',
        orderNo: 'Simagan-07',
        payer: 'Simagan',
        status: 'SR_Received',
        imageUrl: null,
        imageName: null,
        isDeposit: false,
        isMerged: false,
        note: 'Final payment for Simagan-07',
        createdAt: '2026-05-05T00:00:00.000Z',
        creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      },
    },
    {
      id: 'item-2',
      mark: 'Sabou',
      orderNo: 'Sabou-01',
      amount: 3003,
      receiptId: null,
      receipt: {
        id: 'receipt-2',
        receiptNo: 'RCPT-2',
        date: '2026-05-05T00:00:00.000Z',
        tel: null,
        usd: 3003,
        invNo: 'INV-2',
        orderNo: 'Sabou-01',
        payer: 'Sabou',
        status: 'SR_Received',
        imageUrl: null,
        imageName: null,
        isDeposit: false,
        isMerged: false,
        note: null,
        createdAt: '2026-05-05T00:00:00.000Z',
        creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      },
    },
  ],
};

describe('detail-export-image', () => {
  it('builds svg content using the payment-details sheet layout', () => {
    const svg = buildDetailExportSvg(detail);

    expect(svg).toContain('TOTAL');
    expect(svg).toContain('TRANSACTIONS');
    expect(svg).toContain('Simagan');
    expect(svg).toContain('Simagan-07');
    expect(svg).toContain('Final');
    expect(svg).toContain('Mitty Group');
    expect(svg).toContain('Total transferred');
    expect(svg).toContain("font-family: 'DetailExportSans'");
    expect(svg).toContain('data:image/png;base64,');
    expect(svg).not.toContain('>Date<');
  });

  it('renders a jpeg buffer from the sheet layout', async () => {
    const jpeg = await renderDetailExportJpeg(detail);
    const metadata = await sharp(jpeg).metadata();

    expect(Buffer.isBuffer(jpeg)).toBe(true);
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(metadata.width).toBe(1560);
    expect((metadata.height ?? 0) > 0).toBe(true);
  });
});
