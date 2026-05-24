import { stat, writeFile } from 'node:fs/promises';
import { buildDetailPreviewImageFileName, regenerateDetailPreviewImage } from '@/lib/detail-image-assets';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  rename: jest.fn(),
  stat: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/db', () => ({
  db: {
    detail: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    uploadedAsset: {
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/detail-export-image', () => ({
  buildDetailExportViewModel: jest.fn(),
  renderDetailExportJpeg: jest.fn(),
}));

jest.mock('@/lib/uploaded-asset-service', () => ({
  resolveUploadedAssetAbsolutePath: (assetPath: string) => `/tmp/upload${assetPath.replace('/upload/images', '')}`,
}));

import { db } from '@/lib/db';
import { buildDetailExportViewModel, renderDetailExportJpeg } from '@/lib/detail-export-image';

const mockDb = db as unknown as {
  detail: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  uploadedAsset: {
    updateMany: jest.Mock;
    upsert: jest.Mock;
  };
};
const mockBuildDetailExportViewModel = buildDetailExportViewModel as jest.Mock;
const mockRenderDetailExportJpeg = renderDetailExportJpeg as jest.Mock;
const mockStat = stat as jest.Mock;
const mockWriteFile = writeFile as jest.Mock;

describe('detail-image-assets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UPLOAD_DIR = '/tmp/upload';
    process.env.UPLOAD_PUBLIC_PATH = '/upload/images';
    mockStat.mockResolvedValue({ size: 4 });
    mockDb.uploadedAsset.updateMany.mockResolvedValue({ count: 0 });
  });

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

  it('regenerates export artwork over the existing generated preview image', async () => {
    const existingPath = '/upload/images/details/ocr/payment-detail_500_2026-05-23_Mitty_Group.jpg';
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-1',
      date: '2026-05-23T00:00:00.000Z',
      createdAt: '2026-05-24T00:00:00.000Z',
      totalAmount: 500,
      createdBy: 'admin-1',
      imageUrl: existingPath,
      imageName: 'payment-detail_500_2026-05-23_Mitty_Group.jpg',
      agent: { companyName: 'Mitty Group' },
      creator: { id: 'admin-1', name: 'Admin', email: 'admin@example.com' },
      items: [],
      swift: null,
    });
    mockBuildDetailExportViewModel.mockResolvedValueOnce({
      dateLabel: '23 / 05 / 2026',
      totalAmount: 500,
      transactionCount: 1,
      footerAgentLabel: 'Mitty Group',
      rows: [],
    });
    mockRenderDetailExportJpeg.mockResolvedValueOnce(jpeg);

    const result = await regenerateDetailPreviewImage('detail-1', { includeBuffer: true });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/upload/details/ocr/payment-detail_500_2026-05-23_Mitty_Group.jpg',
      jpeg,
    );
    expect(result).toEqual({
      path: existingPath,
      name: 'payment-detail_500_2026-05-23_Mitty_Group.jpg',
      mimeType: 'image/jpeg',
      buffer: jpeg,
    });
    expect(mockDb.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-1' },
      data: {
        imageUrl: existingPath,
        imageName: 'payment-detail_500_2026-05-23_Mitty_Group.jpg',
      },
    });
  });
});
