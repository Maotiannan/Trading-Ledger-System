import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
} from '@prisma/client';
import { db } from '@/lib/db';
import {
  attachUploadedAssetByPath,
  registerUploadedAsset,
  uploadedAssetSubDirForCategory,
} from '@/lib/uploaded-asset-service';

jest.mock('@/lib/db', () => ({
  db: {
    uploadedAsset: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockCreate = db.uploadedAsset.create as jest.Mock;
const mockUpdateMany = db.uploadedAsset.updateMany as jest.Mock;

describe('uploaded-asset-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      id: 'asset-1',
      path: '/upload/images/receipts/direct/test.png',
      name: 'test.png',
      category: UploadedAssetCategory.RECEIPT_DIRECT,
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdBy: 'user-1',
      status: UploadedAssetStatus.STAGED,
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('registers a staged asset immediately after a successful NAS write', async () => {
    const result = await registerUploadedAsset({
      path: '/upload/images/receipts/direct/test.png',
      name: 'test.png',
      category: UploadedAssetCategory.RECEIPT_DIRECT,
      mimeType: 'image/png',
      sizeBytes: 1024,
      createdBy: 'user-1',
      expiresAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: UploadedAssetStatus.STAGED }),
    }));
    expect(result.status).toBe(UploadedAssetStatus.STAGED);
  });

  it('promotes a staged asset to attached by public path', async () => {
    await attachUploadedAssetByPath({
      path: '/upload/images/receipts/direct/test.png',
      attachedType: UploadedAssetAttachmentType.RECEIPT,
      attachedId: 'receipt-1',
    });

    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: UploadedAssetStatus.ATTACHED,
        attachedType: UploadedAssetAttachmentType.RECEIPT,
        attachedId: 'receipt-1',
        expiresAt: null,
      }),
    }));
  });

  it('maps uploaded asset categories to upload sub-directories', () => {
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.RECEIPT_DIRECT)).toBe('receipts/direct');
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.RECEIPT_OCR)).toBe('receipts/ocr');
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.DETAIL_OCR)).toBe('details/ocr');
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.SWIFT_OCR)).toBe('swifts/ocr');
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.RECEIPT_GENERATOR_FINAL)).toBe('receipts/generated');
    expect(uploadedAssetSubDirForCategory(UploadedAssetCategory.RECEIPT_GENERATOR_SIGNATURE)).toBe('receipts/generated/signatures');
  });
});
