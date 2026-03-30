import { NextRequest, NextResponse } from 'next/server';
import { DetailStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recognizeDetail } from '@/lib/ocr';
import { findMatchingReceipt } from '@/lib/matching';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { assertSearchLength, detailPayloadSchema, InputValidationError, parseJsonWithSchema } from '@/lib/validators';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildDetailVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { createDetailRecord, updateDetailRecord } from '@/lib/detail-service';

function parseDetailPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, detailPayloadSchema, '明细数据格式错误');
  }
  const result = detailPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || '明细数据格式错误');
  }
  return result.data;
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as DetailStatus | null;
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      buildDetailVisibilityWhere(ownerIds),
    ];

    if (status) filters.push({ status });
    if (search) assertSearchLength(search);
    if (dateFrom || dateTo) {
      filters.push({
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
        },
      });
    }
    if (minAmount || maxAmount) {
      filters.push({
        totalAmount: {
          ...(minAmount ? { gte: Number(minAmount) } : {}),
          ...(maxAmount ? { lte: Number(maxAmount) } : {}),
        },
      });
    }
    const where = filters.length === 1 ? filters[0] : { AND: filters };

    const details = await db.detail.findMany({
      where,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        items: {
          include: {
            receipt: true,
          },
        },
        swift: true,
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: filterRowsBySearch(details, search) });
  } catch (error) {
    console.error('Get details error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { action, data: requestData, file } = await parseActionRequest(request);
    const detailId = typeof requestData.detailId === 'string' ? requestData.detailId : '';

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
        const ocrResult = await recognizeDetail(base64);

        const matchedItems: Array<(typeof ocrResult.items)[number] & { matchedReceiptId: string | null }> = [];
        for (const item of ocrResult.items) {
          const matchedReceiptId = await findMatchingReceipt(item.orderNo, item.amount);
          matchedItems.push({ ...item, matchedReceiptId });
        }

        const imagePath = await saveUploadedImage(file);

        return NextResponse.json({
          success: true,
          data: {
            ocrResult: { ...ocrResult, items: matchedItems },
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
      const result = await createDetailRecord({
        currentUser,
        payload: parseDetailPayload(requestData),
        imagePath: typeof requestData.imagePath === 'string' ? requestData.imagePath : null,
        imageName: typeof requestData.imageName === 'string' ? requestData.imageName : null,
        mode: action,
      });
      return createApiSuccessResponse({
        data: result.data,
        message: result.message,
      }, request);
    }

    if (action === 'update') {
      if (!detailId) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少明细ID',
        });
      }
      if (!requestData.data) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少更新数据',
        });
      }

      const payload = typeof requestData.data === 'string'
        ? parseJsonWithSchema(requestData.data, detailPayloadSchema, '明细数据格式错误')
        : parseDetailPayload(requestData);
      const result = await updateDetailRecord({
        currentUser,
        detailId,
        payload,
        imagePath: typeof requestData.imagePath === 'string' ? requestData.imagePath : null,
        imageName: typeof requestData.imageName === 'string' ? requestData.imageName : null,
      });
      return NextResponse.json({ success: true, data: result.data });
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Detail API error:', error);
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
