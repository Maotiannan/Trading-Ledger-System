import { buildDetailPreviewImageFileName } from '@/lib/detail-image-assets';

jest.mock('@/lib/db', () => ({
  db: {},
}));

jest.mock('@/lib/detail-export-image', () => ({
  buildDetailExportViewModel: jest.fn(),
  renderDetailExportJpeg: jest.fn(),
}));

describe('detail-image-assets', () => {
  it('names payment detail images with amount, date and payment agent', () => {
    expect(buildDetailPreviewImageFileName({
      id: 'detail-1',
      date: '2026-05-23T00:00:00.000Z',
      createdAt: '2026-05-24T00:00:00.000Z',
      totalAmount: 101326.49,
      createdBy: 'admin-1',
      agent: { companyName: 'Mitty Group' },
      items: [],
    })).toBe('payment-detail_101326_2026-05-23_Mitty_Group.jpg');
  });
});
