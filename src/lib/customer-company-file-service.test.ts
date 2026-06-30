import { rm } from 'fs/promises';
import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
  UserRole,
} from '@prisma/client';
import { db } from '@/lib/db';
import {
  deleteCustomerCompanyFile,
  listCustomerCompanyFiles,
  recognizeAndAttachCustomerCompanyFile,
} from '@/lib/customer-company-file-service';
import { stageUploadedAsset } from '@/lib/uploaded-asset-service';
import { recognizeCustomerCompanyDocument } from '@/lib/ocr';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { logger } from '@/lib/logger';

jest.mock('fs/promises', () => ({ rm: jest.fn() }));
jest.mock('@/lib/uploaded-asset-service', () => ({
  stageUploadedAsset: jest.fn(),
  resolveUploadedAssetAbsolutePath: jest.fn((path: string) => `/abs${path}`),
}));
jest.mock('@/lib/ocr-input', () => ({ toOcrDataUrl: jest.fn() }));
jest.mock('@/lib/ocr', () => ({ recognizeCustomerCompanyDocument: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: jest.fn() },
    uploadedAsset: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  },
}));

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
};

function makeFile(name = 'company.pdf', type = 'application/pdf') {
  return {
    name,
    type,
    size: 12,
    arrayBuffer: async () => Buffer.from('%PDF-test').buffer,
  } as File;
}

describe('customer-company-file-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.customer.findFirst as jest.Mock).mockResolvedValue({
      id: 'customer-1',
      companyName: 'OLD CO',
      companyAddress: 'OLD ADDRESS',
      city: 'OLD CITY',
    });
    (stageUploadedAsset as jest.Mock).mockResolvedValue({
      path: '/upload/images/customers/files/company.pdf',
      name: 'company.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
    });
    (toOcrDataUrl as jest.Mock).mockResolvedValue('data:application/pdf;base64,abc');
    (recognizeCustomerCompanyDocument as jest.Mock).mockResolvedValue({
      companyName: 'NEW CO',
      companyAddress: 'NEW ADDRESS',
      city: 'NEW CITY',
    });
    (db.uploadedAsset.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (db.uploadedAsset.findMany as jest.Mock).mockResolvedValue([]);
    (db.uploadedAsset.findFirst as jest.Mock).mockResolvedValue({
      id: 'asset-1',
      path: '/upload/images/customers/files/company.pdf',
      name: 'company.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      createdAt: new Date('2026-06-30T00:00:00.000Z'),
      attachedId: 'customer-1',
    });
    (rm as jest.Mock).mockResolvedValue(undefined);
  });

  it('saves a company file, attaches it to the customer, and returns OCR fields with current values', async () => {
    const result = await recognizeAndAttachCustomerCompanyFile({
      currentUser: adminUser,
      customerId: 'customer-1',
      file: makeFile(),
    });

    expect(stageUploadedAsset).toHaveBeenCalledWith({
      file: expect.anything(),
      category: UploadedAssetCategory.CUSTOMER_FILE,
      createdBy: 'admin-1',
    });
    expect(db.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        path: '/upload/images/customers/files/company.pdf',
        status: UploadedAssetStatus.STAGED,
      }),
      data: expect.objectContaining({
        status: UploadedAssetStatus.ATTACHED,
        attachedType: UploadedAssetAttachmentType.CUSTOMER_FILE,
        attachedId: 'customer-1',
      }),
    }));
    expect(result.data.ocrResult).toEqual({
      companyName: 'NEW CO',
      companyAddress: 'NEW ADDRESS',
      city: 'NEW CITY',
    });
    expect(result.data.currentValues).toEqual({
      companyName: 'OLD CO',
      companyAddress: 'OLD ADDRESS',
      city: 'OLD CITY',
    });
  });

  it('lists only attached company files for the accessible customer', async () => {
    (db.uploadedAsset.findMany as jest.Mock).mockResolvedValue([{ id: 'asset-1', path: '/upload/images/customers/files/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, createdAt: new Date('2026-06-30T00:00:00.000Z') }]);

    const result = await listCustomerCompanyFiles(adminUser, 'customer-1');

    expect(db.uploadedAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        category: UploadedAssetCategory.CUSTOMER_FILE,
        attachedType: UploadedAssetAttachmentType.CUSTOMER_FILE,
        attachedId: 'customer-1',
        status: UploadedAssetStatus.ATTACHED,
      }),
    }));
    expect(result.data).toEqual([{ id: 'asset-1', path: '/upload/images/customers/files/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, createdAt: '2026-06-30T00:00:00.000Z' }]);
  });

  it('marks the file deleted and removes the NAS source file when deleting a customer company file', async () => {
    await deleteCustomerCompanyFile(adminUser, 'asset-1');

    expect(rm).toHaveBeenCalledWith('/abs/upload/images/customers/files/company.pdf', { force: true });
    expect(db.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'asset-1', status: UploadedAssetStatus.ATTACHED }),
      data: expect.objectContaining({ status: UploadedAssetStatus.DELETED, deletedAt: expect.any(Date) }),
    }));
  });

  it('keeps the file attached when the NAS source file cannot be removed', async () => {
    (rm as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));

    await expect(deleteCustomerCompanyFile(adminUser, 'asset-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });

    expect(db.uploadedAsset.updateMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Delete customer company file source failed', expect.objectContaining({
      assetId: 'asset-1',
      path: '/upload/images/customers/files/company.pdf',
    }));
  });

  it('rejects company file operations when the customer is outside the user scope', async () => {
    (db.customer.findFirst as jest.Mock).mockResolvedValueOnce(null);

    await expect(listCustomerCompanyFiles(adminUser, 'customer-1')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });
});
