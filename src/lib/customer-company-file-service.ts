import { rm } from 'fs/promises';
import { TextDecoder } from 'util';
import {
  UploadedAssetAttachmentType,
  UploadedAssetCategory,
  UploadedAssetStatus,
  UserRole,
} from '@prisma/client';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { customerAccessWhere } from '@/lib/customer-scope';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recognizeCustomerCompanyDocument, recognizeCustomerCompanyText } from '@/lib/ocr';
import { toOcrDataUrl } from '@/lib/ocr-input';
import type { CurrentUser } from '@/lib/request-auth';
import type { CustomerCompanyFileOcrResult } from '@/lib/types';
import { resolveUploadedAssetAbsolutePath, stageUploadedAsset } from '@/lib/uploaded-asset-service';

export type CustomerCompanyFileSummary = {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

const EMPTY_OCR_RESULT: CustomerCompanyFileOcrResult = {
  companyName: null,
  companyAddress: null,
  city: null,
};

function trimNullable(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' });
  }
}

async function getAccessibleCustomer(currentUser: CurrentUser, customerId: string) {
  ensureManager(currentUser);
  const id = String(customerId || '').trim();
  if (!id) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '缺少客户ID' });
  }

  const customer = await db.customer.findFirst({
    where: {
      ...customerAccessWhere(currentUser),
      id,
    },
    select: {
      id: true,
      companyName: true,
      companyAddress: true,
      city: true,
    },
  });
  if (!customer) {
    throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '客户不存在或无权限' });
  }
  return customer;
}

function toFileSummary(row: {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): CustomerCompanyFileSummary {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}

function isTextUpload(file: File): boolean {
  const name = String(file.name || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  return mime.startsWith('text/') || name.endsWith('.txt');
}

function isUnsupportedOfficeUpload(file: File): boolean {
  const name = String(file.name || '').toLowerCase();
  return /\.(doc|docx|xls|xlsx)$/i.test(name);
}

async function recognizeCustomerFile(file: File): Promise<{ ocrResult: CustomerCompanyFileOcrResult; recognitionMessage: string | null }> {
  if (isUnsupportedOfficeUpload(file)) {
    return {
      ocrResult: EMPTY_OCR_RESULT,
      recognitionMessage: '文件已保存；当前Office文件类型暂不自动识别，请手动维护公司信息。',
    };
  }

  try {
    if (isTextUpload(file)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const result = await recognizeCustomerCompanyText(text);
      return {
        ocrResult: {
          companyName: trimNullable(result.companyName),
          companyAddress: trimNullable(result.companyAddress),
          city: trimNullable(result.city),
        },
        recognitionMessage: null,
      };
    }

    const ocrInput = await toOcrDataUrl(file);
    const result = await recognizeCustomerCompanyDocument(ocrInput);
    return {
      ocrResult: {
        companyName: trimNullable(result.companyName),
        companyAddress: trimNullable(result.companyAddress),
        city: trimNullable(result.city),
      },
      recognitionMessage: null,
    };
  } catch (error) {
    logger.error('Customer company file OCR failed', { error, fileName: file.name, fileType: file.type });
    return {
      ocrResult: EMPTY_OCR_RESULT,
      recognitionMessage: '文件已保存，但AI识别失败，请手动维护公司信息。',
    };
  }
}

export async function listCustomerCompanyFiles(currentUser: CurrentUser, customerId: string) {
  const customer = await getAccessibleCustomer(currentUser, customerId);
  const rows = await db.uploadedAsset.findMany({
    where: {
      category: UploadedAssetCategory.CUSTOMER_FILE,
      attachedType: UploadedAssetAttachmentType.CUSTOMER_FILE,
      attachedId: customer.id,
      status: UploadedAssetStatus.ATTACHED,
    },
    select: {
      id: true,
      path: true,
      name: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  return {
    data: rows.map(toFileSummary),
    message: `客户公司文件已加载，共 ${rows.length} 个`,
  };
}

export async function recognizeAndAttachCustomerCompanyFile(input: {
  currentUser: CurrentUser;
  customerId: string;
  file: File;
}) {
  const customer = await getAccessibleCustomer(input.currentUser, input.customerId);
  const saved = await stageUploadedAsset({
    file: input.file,
    category: UploadedAssetCategory.CUSTOMER_FILE,
    createdBy: input.currentUser.id,
  });

  const attachResult = await db.uploadedAsset.updateMany({
    where: {
      path: saved.path,
      status: UploadedAssetStatus.STAGED,
    },
    data: {
      status: UploadedAssetStatus.ATTACHED,
      attachedType: UploadedAssetAttachmentType.CUSTOMER_FILE,
      attachedId: customer.id,
      expiresAt: null,
    },
  });
  if (attachResult.count !== 1) {
    throw createApiError({ code: apiErrorCodes.INTERNAL_ERROR, status: 500, message: '客户公司文件绑定失败' });
  }

  const { ocrResult, recognitionMessage } = await recognizeCustomerFile(input.file);

  return {
    data: {
      file: {
        id: null,
        path: saved.path,
        name: saved.name,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        createdAt: new Date().toISOString(),
      },
      ocrResult,
      recognitionMessage,
      currentValues: {
        companyName: customer.companyName || '',
        companyAddress: customer.companyAddress || '',
        city: customer.city || '',
      },
    },
    message: recognitionMessage || '客户公司文件已上传并识别',
  };
}

export async function deleteCustomerCompanyFile(currentUser: CurrentUser, assetId: string) {
  ensureManager(currentUser);
  const id = String(assetId || '').trim();
  if (!id) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '缺少文件ID' });
  }

  const asset = await db.uploadedAsset.findFirst({
    where: {
      id,
      category: UploadedAssetCategory.CUSTOMER_FILE,
      attachedType: UploadedAssetAttachmentType.CUSTOMER_FILE,
      status: UploadedAssetStatus.ATTACHED,
    },
    select: {
      id: true,
      path: true,
      attachedId: true,
    },
  });
  if (!asset || !asset.attachedId) {
    throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '客户公司文件不存在' });
  }

  await getAccessibleCustomer(currentUser, asset.attachedId);
  try {
    await rm(resolveUploadedAssetAbsolutePath(asset.path), { force: true });
  } catch (error) {
    logger.error('Delete customer company file source failed', { assetId: asset.id, path: asset.path, error });
    throw createApiError({
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '客户公司文件源文件删除失败，请检查NAS挂载目录',
    });
  }

  await db.uploadedAsset.updateMany({
    where: {
      id: asset.id,
      status: UploadedAssetStatus.ATTACHED,
    },
    data: {
      status: UploadedAssetStatus.DELETED,
      deletedAt: new Date(),
    },
  });

  return { message: '客户公司文件已删除' };
}
