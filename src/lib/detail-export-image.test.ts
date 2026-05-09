import sharp from 'sharp';
import {
  buildDetailExportViewModel,
  buildDetailExportSvg,
  getDetailExportFontPaths,
  renderDetailExportJpeg,
  type DetailExportViewModel,
} from '@/lib/detail-export-image';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
    },
  },
}));

import { db } from '@/lib/db';

const mockDb = db as unknown as {
  order: {
    findMany: jest.Mock;
  };
  receipt: {
    findMany: jest.Mock;
  };
};

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies payment detail rows from order balance and receipt history', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-initial', orderBalance: 2785 },
      { id: 'order-std', orderBalance: 1197 },
      { id: 'order-final', orderBalance: 0 },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { id: 'receipt-initial', orderId: 'order-initial', createdAt: new Date('2026-05-01T00:00:00.000Z') },
      { id: 'receipt-std-old', orderId: 'order-std', createdAt: new Date('2026-04-01T00:00:00.000Z') },
      { id: 'receipt-std-current', orderId: 'order-std', createdAt: new Date('2026-05-01T00:00:00.000Z') },
      { id: 'receipt-final-old', orderId: 'order-final', createdAt: new Date('2026-04-01T00:00:00.000Z') },
      { id: 'receipt-final-current', orderId: 'order-final', createdAt: new Date('2026-05-01T00:00:00.000Z') },
    ]);

    const model = await buildDetailExportViewModel({
      id: 'detail-1',
      date: '2026-05-05T00:00:00.000Z',
      createdAt: '2026-05-06T00:00:00.000Z',
      totalAmount: 340,
      swift: { status: 'RECEIVED' },
      agent: { companyName: 'Mitty Group' },
      items: [
        { mark: 'THP', orderNo: 'THP-04', amount: 100, receipt: { id: 'receipt-initial', orderNo: 'THP-04', orderId: 'order-initial', createdAt: '2026-05-01T00:00:00.000Z' } },
        { mark: 'MSP', orderNo: 'MSP-06', amount: 120, receipt: { id: 'receipt-std-current', orderNo: 'MSP-06', orderId: 'order-std', createdAt: '2026-05-01T00:00:00.000Z' } },
        { mark: 'IBS', orderNo: 'IBS-01', amount: 120, receipt: { id: 'receipt-final-current', orderNo: 'IBS-01', orderId: 'order-final', createdAt: '2026-05-01T00:00:00.000Z' } },
      ],
    });

    expect(model.rows.map((row) => ({ orderNo: row.orderNo, type: row.type }))).toEqual([
      { orderNo: 'THP-04', type: 'Initial' },
      { orderNo: 'MSP-06', type: 'Std' },
      { orderNo: 'IBS-01', type: 'Final' },
    ]);
  });

  it('classifies cleared balances as Final once SWIFT has entered bank transfer', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-final', orderBalance: 0 },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { id: 'receipt-final-old', orderId: 'order-final', createdAt: new Date('2026-04-01T00:00:00.000Z') },
      { id: 'receipt-final-current', orderId: 'order-final', createdAt: new Date('2026-05-01T00:00:00.000Z') },
    ]);

    const model = await buildDetailExportViewModel({
      id: 'detail-1',
      date: '2026-05-05T00:00:00.000Z',
      createdAt: '2026-05-06T00:00:00.000Z',
      totalAmount: 120,
      swift: { status: 'Bank_Transfer' },
      items: [
        { mark: 'IBS', orderNo: 'IBS-01', amount: 120, receipt: { id: 'receipt-final-current', orderNo: 'IBS-01', orderId: 'order-final', createdAt: '2026-05-01T00:00:00.000Z' } },
      ],
    });

    expect(model.rows[0].type).toBe('Final');
  });

  it('keeps a first payment as Final when it also clears the order', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-first-final', orderBalance: 0 },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { id: 'receipt-first-final', orderId: 'order-first-final', createdAt: new Date('2026-05-01T00:00:00.000Z') },
    ]);

    const model = await buildDetailExportViewModel({
      id: 'detail-1',
      date: '2026-05-05T00:00:00.000Z',
      createdAt: '2026-05-06T00:00:00.000Z',
      totalAmount: 120,
      swift: { status: 'RECEIVED' },
      items: [
        { mark: 'IBS', orderNo: 'IBS-01', amount: 120, receipt: { id: 'receipt-first-final', orderNo: 'IBS-01', orderId: 'order-first-final', createdAt: '2026-05-01T00:00:00.000Z' } },
      ],
    });

    expect(model.rows[0].type).toBe('Final');
  });

  it('does not classify a cleared balance as Final before SWIFT is attached', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-final', orderBalance: 0 },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { id: 'receipt-final-old', orderId: 'order-final', createdAt: new Date('2026-04-01T00:00:00.000Z') },
      { id: 'receipt-final-current', orderId: 'order-final', createdAt: new Date('2026-05-01T00:00:00.000Z') },
    ]);

    const model = await buildDetailExportViewModel({
      id: 'detail-1',
      date: '2026-05-05T00:00:00.000Z',
      createdAt: '2026-05-06T00:00:00.000Z',
      totalAmount: 120,
      swift: null,
      items: [
        { mark: 'IBS', orderNo: 'IBS-01', amount: 120, receipt: { id: 'receipt-final-current', orderNo: 'IBS-01', orderId: 'order-final', createdAt: '2026-05-01T00:00:00.000Z' } },
      ],
    });

    expect(model.rows[0].type).toBe('Std');
  });

  it('builds svg content using the payment details export layout', () => {
    const svg = buildDetailExportSvg(viewModel);

    expect(svg).toContain('TOTAL');
    expect(svg).toContain('TRANSACTIONS');
    expect(svg).toContain('ORDER NO');
    expect(svg).toContain('Simagan');
    expect(svg).toContain('Simagan-07');
    expect(svg).toContain('Final');
    expect(svg).toContain('Initial');
    expect(svg).toContain('Standard');
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
    expect(svg).toContain('font-size="16" font-weight="700" fill="#000000" letter-spacing="0.8">MARK');
    expect(svg).toContain('font-size="13" fill="#000000">Simagan-07');
    expect(svg).toContain('font-size="12" font-weight="700" fill="#000000">Standard');
    expect(svg).toContain('font-size="24" font-weight="700" fill="#415cc3">$101,326</text>');
    expect(svg).toContain('font-size="11" font-weight="700" fill="#000000" letter-spacing="1.1">TOTAL');
    expect(svg).toContain('font-size="22" font-weight="700" fill="#ffffff" letter-spacing="0.6">TOTAL TRANSFERRED');
    expect(svg).toContain('font-size="15" fill="#cccccc">Mitty Group · Disbursement');
    expect(svg).toContain('font-size="15" text-anchor="end" fill="#cccccc">20 records');
  });

  it('uses bundled Arial font files for deterministic server rendering', () => {
    const fontPaths = getDetailExportFontPaths();

    expect(fontPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/arial\.ttf$/),
      expect.stringMatching(/arial-bold\.ttf$/),
    ]));
  });
});
