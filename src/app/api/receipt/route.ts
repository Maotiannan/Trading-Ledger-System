import { NextRequest, NextResponse } from 'next/server';
import { ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recognizeReceipt } from '@/lib/ocr';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, receiptPayloadSchema } from '@/lib/validators';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { filterRowsBySearch } from '@/lib/text-search';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  createReceiptRecord,
  markReceiptReceived,
  updateReceiptRecord,
} from '@/lib/receipt-service';

function parseReceiptPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, receiptPayloadSchema, '收据数据格式错误');
  }
  const result = receiptPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || '收据数据格式错误');
  }
  return result.data;
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as ReceiptStatus | null;
    const search = searchParams.get('search') || '';
    const orderId = searchParams.get('orderId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minUsd = searchParams.get('minUsd');
    const maxUsd = searchParams.get('maxUsd');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      {
        OR: [
          { createdBy: { in: ownerIds } },
          { customer: { createdBy: { in: ownerIds } } },
        ],
      },
    ];

    if (status) filters.push({ status });
    if (search) assertSearchLength(search);
    if (orderId) filters.push({ orderId });
    if (dateFrom || dateTo) {
      filters.push({
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
        },
      });
    }
    if (minUsd || maxUsd) {
      filters.push({
        usd: {
          ...(minUsd ? { gte: Number(minUsd) } : {}),
          ...(maxUsd ? { lte: Number(maxUsd) } : {}),
        },
      });
    }
    const where = filters.length === 1 ? filters[0] : { AND: filters };

    const receipts = await db.receipt.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        order: true,
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: filterRowsBySearch(receipts, search) });
  } catch (error) {
    console.error('Get receipts error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { action, data, file } = await parseActionRequest(request);
    const receiptId = typeof data.receiptId === 'string' ? data.receiptId : '';

    if (action === 'recognize') {
      if (!file) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '请上传图片',
        });
      }

      try {
        const base64 = await toOcrDataUrl(file);
        const ocrResult = await recognizeReceipt(base64);
        const imagePath = await saveUploadedImage(file);

        return NextResponse.json({
          success: true,
          data: {
            ocrResult,
            image: imagePath,
          },
        });
      } catch (error) {
        if (error instanceof UploadValidationError) {
          throw createApiError({
            code: 'BAD_REQUEST',
            status: 400,
            message: error.message,
          });
        }
        const detail = error instanceof Error ? error.message : '未知错误';
        throw createApiError({
          code: 'INTERNAL_ERROR',
          status: 500,
          message: `AI识别失败：${detail}`,
        });
      }
    }

    if (action === 'confirm' || action === 'direct-create') {
      const result = await createReceiptRecord({
        currentUser,
        payload: parseReceiptPayload(data),
        imagePath: typeof data.imagePath === 'string' ? data.imagePath : null,
        imageName: typeof data.imageName === 'string' ? data.imageName : null,
        mode: action,
      });
      return createApiSuccessResponse({
        data: result.data,
        message: result.message,
      }, request);
    }

    if (action === 'update') {
      if (!receiptId) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少收据ID',
        });
      }
      if (!data.data) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少更新数据',
        });
      }

      const payload = typeof data.data === 'string'
        ? parseJsonWithSchema(data.data, receiptPayloadSchema, '收据数据格式错误')
        : parseReceiptPayload(data);
      const result = await updateReceiptRecord({
        currentUser,
        receiptId,
        payload,
        imagePath: typeof data.imagePath === 'string' ? data.imagePath : null,
        imageName: typeof data.imageName === 'string' ? data.imageName : null,
      });
      return NextResponse.json({ success: true, data: result.data });
    }

    if (action === 'mark-received') {
      const result = await markReceiptReceived({ currentUser, receiptId });
      return NextResponse.json({ success: true, data: result.data });
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Receipt API error:', error);
    if (error instanceof UploadValidationError || error instanceof InputValidationError) {
      return toApiErrorResponse(error, {
        code: 'BAD_REQUEST',
        status: 400,
        message: error.message,
      }, request);
    }
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
