import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
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

const DEFAULT_UPLOAD_DIR = '/app/upload/images';
const PUBLIC_UPLOAD_PREFIX = '/upload/images/';
const UPLOAD_CATEGORY_DIRS: Record<string, string> = {
  'receipt-direct': 'receipts/direct',
};

function resolveImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.heif') return 'image/heif';
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
    const [receipt, detail, swift] = await Promise.all([
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
    ]);
    if (!receipt && !detail && !swift) {
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
    console.error('Read upload image error:', error);
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
    const subDir = category ? UPLOAD_CATEGORY_DIRS[category] : '';
    if (category && !subDir) {
      throw createApiError({
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: '上传分类无效',
        detail: { category },
      });
    }

    const image = await saveUploadedImage(file, { subDir });
    return createApiSuccessResponse({ data: image }, request);
  } catch (error) {
    console.error('Upload image error:', error);
    if (error instanceof UploadValidationError) {
      return toApiErrorResponse(error, {
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: error.message,
      }, request);
    }
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '图片上传失败',
    }, request);
  }
}
