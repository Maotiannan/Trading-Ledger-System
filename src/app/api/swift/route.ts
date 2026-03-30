import { NextRequest, NextResponse } from 'next/server';
import { DetailStatus, ReceiptStatus, SwiftStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recognizeSwift } from '@/lib/ocr';
import { withAuth } from '@/lib/route-auth';
import { saveUploadedImage, UploadValidationError } from '@/lib/upload';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, swiftPayloadSchema } from '@/lib/validators';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildSwiftVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiError } from '@/lib/api-error';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { createSwiftRecord, deleteSwiftRecord } from '@/lib/swift-service';

function parseSwiftPayload(data: Record<string, unknown>) {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, swiftPayloadSchema, 'SWIFT数据格式错误');
  }
  const result = swiftPayloadSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || 'SWIFT数据格式错误');
  }
  return result.data;
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');
    const hasError = searchParams.get('hasError');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      buildSwiftVisibilityWhere(ownerIds),
    ];
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
        amount: {
          ...(minAmount ? { gte: Number(minAmount) } : {}),
          ...(maxAmount ? { lte: Number(maxAmount) } : {}),
        },
      });
    }
    if (hasError === 'true' || hasError === 'false') {
      filters.push({ hasError: hasError === 'true' });
    }
    const where = filters.length === 1 ? filters[0] : { AND: filters };

    const swifts = await db.swift.findMany({
      where,
      include: {
        detail: {
          include: {
            items: { include: { receipt: true } },
          },
        },
        creator: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: filterRowsBySearch(swifts, search) });
  } catch (error) {
    console.error('Get swifts error:', error);
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
        const ocrResult = await recognizeSwift(base64);
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
      const payload = parseSwiftPayload(requestData);
      const result = await createSwiftRecord({
        currentUser,
        detailId: typeof requestData.detailId === 'string' ? requestData.detailId : '',
        payload,
        imagePath: typeof requestData.imagePath === 'string' ? requestData.imagePath : null,
        imageName: typeof requestData.imageName === 'string' ? requestData.imageName : null,
        mode: action,
      });

      return createApiSuccessResponse({
        data: {
          swift: result.swift,
          validation: result.validation,
        },
        message: result.message,
      }, request);
    }

    if (action === 'delete') {
      const result = await deleteSwiftRecord({
        currentUser,
        swiftId: typeof requestData.swiftId === 'string' ? requestData.swiftId : '',
      });
      return createApiSuccessResponse({ message: result.message }, request);
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Swift API error:', error);
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
