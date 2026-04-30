import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
} from '@prisma/client';
import { mkdir, rm, writeFile } from 'fs/promises';
import { db } from '@/lib/db';
import { saveUploadedImage } from '@/lib/upload';
import {
  attachUploadedAssetByPath,
  registerUploadedAsset,
  stageUploadedAsset,
  uploadedAssetSubDirForCategory,
} from '@/lib/uploaded-asset-service';
import { getUploadedAssetCleanupSettings } from '@/lib/system-settings';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  rm: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    uploadedAsset: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/system-settings', () => ({
  getUploadedAssetCleanupSettings: jest.fn(),
}));

const mockCreate = db.uploadedAsset.create as jest.Mock;
const mockUpdateMany = db.uploadedAsset.updateMany as jest.Mock;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockGetUploadedAssetCleanupSettings = getUploadedAssetCleanupSettings as jest.Mock;

describe('uploaded-asset-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUploadedAssetCleanupSettings.mockResolvedValue({
      stagedTtlHours: 24,
      signingPendingTtlHours: 72,
    });
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
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
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

  it('promotes a staged asset using the provided transaction client', async () => {
    const tx = {
      uploadedAsset: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await attachUploadedAssetByPath({
      client: tx,
      path: '/upload/images/receipts/direct/test.png',
      attachedType: UploadedAssetAttachmentType.RECEIPT,
      attachedId: 'receipt-1',
    });

    expect(tx.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ path: '/upload/images/receipts/direct/test.png' }),
    }));
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('throws when attach promotion does not update exactly one staged asset', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(attachUploadedAssetByPath({
      path: '/upload/images/receipts/direct/missing.png',
      attachedType: UploadedAssetAttachmentType.RECEIPT,
      attachedId: 'receipt-1',
    })).rejects.toThrow(
      'Expected to attach exactly one staged uploaded asset for path "/upload/images/receipts/direct/missing.png", updated 0.',
    );
  });

  it('derives authoritative upload metadata from the validated file contents and extension', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file = {
      name: 'test.png',
      type: 'image/jpeg',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    } as File;

    const result = await saveUploadedImage(file, { subDir: 'receipts/direct' });

    expect(result.name).toBe('test.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.sizeBytes).toBe(pngBytes.byteLength);
  });

  it('stages an uploaded asset with canonical subdir and ttl settings', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file = {
      name: 'test.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    } as File;

    const result = await stageUploadedAsset({
      file,
      category: UploadedAssetCategory.RECEIPT_DIRECT,
      createdBy: 'user-1',
    });

    expect(mockGetUploadedAssetCleanupSettings).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        category: UploadedAssetCategory.RECEIPT_DIRECT,
        createdBy: 'user-1',
      }),
    }));
    expect(result.path).toMatch(/\/upload\/images\/receipts\/direct\//);
  });

  it('compensates the uploaded file when asset registration fails', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const file = {
      name: 'test.png',
      type: 'image/png',
      size: pngBytes.byteLength,
      arrayBuffer: async () => pngBytes.buffer.slice(
        pngBytes.byteOffset,
        pngBytes.byteOffset + pngBytes.byteLength,
      ),
    } as File;
    mockCreate.mockRejectedValueOnce(new Error('insert failed'));

    await expect(stageUploadedAsset({
      file,
      category: UploadedAssetCategory.RECEIPT_DIRECT,
      createdBy: 'user-1',
    })).rejects.toThrow('insert failed');

    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining('/receipts/direct/'),
      { force: true },
    );
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
