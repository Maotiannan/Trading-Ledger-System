import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { UploadedAssetCategory } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { getCurrentUser } from '@/lib/request-auth';
import { db } from '@/lib/db';
import { buildDetailVisibilityWhere, buildReceiptVisibilityWhere, buildSwiftVisibilityWhere, getOwnerVisibleIds } from '@/lib/resource-visibility';
import { parseActionRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createApiError } from '@/lib/api-error';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { stageUploadedAsset } from '@/lib/uploaded-asset-service';
import { logger } from '@/lib/logger';

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const PUBLIC_UPLOAD_PREFIX = '/upload/images/';
const UPLOAD_CATEGORIES: Record<string, UploadedAssetCategory> = {
  'receipt-direct': UploadedAssetCategory.RECEIPT_DIRECT,
  'agent-file': UploadedAssetCategory.AGENT_FILE,
};

function resolveImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.heif') return 'image/heif';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return createApiErrorResponse({ code: apiErrorCodes.AUTH_REQUIRED, status: 401, message: '未登录' }, request);
    }

    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || '';
    if (!rawPath.startsWith(PUBLIC_UPLOAD_PREFIX)) {
      return createApiErrorResponse({ code: apiErrorCodes.INVALID_FILE_PATH, status: 400, message: '无效图片路径' }, request);
    }

    const relativePath = rawPath.slice(PUBLIC_UPLOAD_PREFIX.length);
    if (!relativePath || relativePath.includes('..')) {
      return createApiErrorResponse({ code: apiErrorCodes.INVALID_FILE_PATH, status: 400, message: '无效图片路径' }, request);
    }

    const ownerIds = await getOwnerVisibleIds(currentUser);
    const [receipt, detail, swift, agentFile] = await Promise.all([
      db.receipt.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildReceiptVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
      db.detail.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildDetailVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
      db.swift.findFirst({
        where: {
          imageUrl: rawPath,
          ...buildSwiftVisibilityWhere(ownerIds),
        },
        select: { id: true },
      }),
      db.paymentAgentFile.findFirst({
        where: {
          path: rawPath,
          agent: {
            createdBy: {
              in: ownerIds,
            },
          },
        },
        select: { id: true },
      }),
    ]);
    if (!receipt && !detail && !swift && !agentFile) {
      return createApiErrorResponse({ code: apiErrorCodes.FILE_ACCESS_DENIED, status: 403, message: '无权访问该图片' }, request);
    }

    const uploadDir = process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
    const absolutePath = path.join(uploadDir, relativePath);
    const content = await readFile(absolutePath);

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': resolveImageMimeType(absolutePath),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    logger.error('Read upload image error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.FILE_READ_FAILED,
      status: 404,
      message: '图片读取失败',
    }, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return createApiErrorResponse({ code: apiErrorCodes.AUTH_REQUIRED, status: 401, message: '未登录' }, request);
    }

    await enforceRateLimit('upload', request, { currentUser });
    const { action, data, file } = await parseActionRequest(request);
    if (action !== 'upload') {
      throw createApiError({
        code: apiErrorCodes.INVALID_ACTION,
        status: 400,
        message: '未知操作',
        detail: { action },
      });
    }
    if (!file) {
      throw createApiError({
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: '请上传图片',
      });
    }

    const category = typeof data.category === 'string' ? data.category.trim() : '';
    const uploadedAssetCategory = category ? UPLOAD_CATEGORIES[category] : null;
    if (category && !uploadedAssetCategory) {
      throw createApiError({
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: '上传分类无效',
        detail: { category },
      });
    }

    const saved = uploadedAssetCategory
      ? await stageUploadedAsset({
          file,
          category: uploadedAssetCategory,
          createdBy: currentUser.id,
        })
      : await saveUploadedImage(file);

    const payload = uploadedAssetCategory === UploadedAssetCategory.AGENT_FILE
      ? {
          path: saved.path,
          name: saved.name,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
        }
      : saved;

    return createApiSuccessResponse({ data: payload }, request);
  } catch (error) {
    if (error instanceof Error && (error.message === 'aborted' || ('code' in error && (error as NodeJS.ErrnoException).code === 'ECONNRESET'))) {
      logger.error('Upload image aborted', {
        code: ('code' in error ? (error as NodeJS.ErrnoException).code : 'ABORTED') || 'ABORTED',
      });
      return createApiErrorResponse({
        code: apiErrorCodes.UPLOAD_ABORTED,
        status: 499,
        message: '上传中断，请在更稳定的网络下重试',
      }, request);
    }
    if (error instanceof UploadValidationError) {
      return toApiErrorResponse(error, {
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: error.message,
      }, request);
    }
    logger.error('Upload image error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '图片上传失败',
    }, request);
  }
}
