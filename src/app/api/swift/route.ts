import { NextRequest, NextResponse } from 'next/server';
import { DetailStatus, ReceiptStatus, SwiftStatus } from '@prisma/client';
import { UploadedAssetCategory } from '@prisma/client';
import { db } from '@/lib/db';
import { recognizeSwift, recognizeSwiftPdf } from '@/lib/ocr';
import { withAuth } from '@/lib/route-auth';
import { UploadValidationError } from '@/lib/upload';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, swiftPayloadSchema } from '@/lib/validators';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildSwiftVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiError } from '@/lib/api-error';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { stageUploadedAsset } from '@/lib/uploaded-asset-service';
import { createSwiftRecord, deleteSwiftRecord, markSwiftReceived, updateSwiftRecord } from '@/lib/swift-service';
import { listSwiftEditRequests, requestSwiftEdit, reviewSwiftEdit } from '@/lib/swift-edit-request-service';
import { normalizeSwiftOcrResult } from '@/lib/swift-normalization';
import { logger } from '@/lib/logger';

function parseSwiftPayloadValue(value: unknown) {
  const normalized = value && typeof value === 'object'
    ? normalizeSwiftOcrResult(value as Record<string, unknown> as never)
    : value;
  if (typeof value === 'string') {
    return parseJsonWithSchema(value, swiftPayloadSchema, 'SWIFT数据格式错误');
  }
  const result = swiftPayloadSchema.safeParse(normalized);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || 'SWIFT数据格式错误');
  }
  return result.data;
}

function parseSwiftPayload(data: Record<string, unknown>) {
  return parseSwiftPayloadValue(data);
}

function parseSwiftCreatePayload(data: Record<string, unknown>) {
  return parseSwiftPayloadValue(data.data ?? data);
}

function isPdfUpload(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

function parseSwiftStatuses(searchParams: URLSearchParams): SwiftStatus[] {
  return searchParams
    .getAll('status')
    .filter((status): status is SwiftStatus => Object.values(SwiftStatus).includes(status as SwiftStatus));
}

function buildSwiftStatusWhere(statuses: SwiftStatus[]): Record<string, unknown> | null {
  if (statuses.length === 0) return null;

  const statusSet = new Set(statuses);
  const filters: Record<string, unknown>[] = [];
  const normalStatuses = statuses.filter((status) => status !== SwiftStatus.ERROR);
  if (normalStatuses.length === 1) {
    filters.push({ status: normalStatuses[0], hasError: false });
  }
  if (normalStatuses.length > 1) {
    filters.push({ status: { in: normalStatuses }, hasError: false });
  }
  if (statusSet.has(SwiftStatus.ERROR)) {
    filters.push({
      OR: [
        { status: SwiftStatus.ERROR },
        { hasError: true },
      ],
    });
  }

  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { OR: filters };
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const amount = searchParams.get('amount');
    const minAmount = searchParams.get('minAmount');
    const maxAmount = searchParams.get('maxAmount');
    const hasError = searchParams.get('hasError');
    const statuses = parseSwiftStatuses(searchParams);

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
    if (amount) {
      filters.push({ amount: Number(amount) });
    } else if (minAmount || maxAmount) {
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
    const statusWhere = buildSwiftStatusWhere(statuses);
    if (statusWhere) filters.push(statusWhere);
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
    logger.error('Get swifts error', error);
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
      await enforceRateLimit('upload', request, { currentUser });
      if (!file) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '请上传SWIFT水单图片或PDF文件',
        });
      }

      try {
        const ocrResult = normalizeSwiftOcrResult(isPdfUpload(file)
          ? await recognizeSwiftPdf(file)
          : await recognizeSwift(await toOcrDataUrl(file)));
        const imagePath = await stageUploadedAsset({
          file,
          category: UploadedAssetCategory.SWIFT_OCR,
          createdBy: currentUser.id,
        });

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
      const payload = parseSwiftCreatePayload(requestData);
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

    if (action === 'update') {
      if (currentUser.role !== 'ADMIN') {
        throw createApiError({
          code: 'FORBIDDEN',
          status: 403,
          message: '只有管理员可以直接修改SWIFT',
          detail: { role: currentUser.role },
        });
      }
      const swiftId = typeof requestData.swiftId === 'string' ? requestData.swiftId : '';
      if (!swiftId) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少SWIFT ID',
        });
      }

      const result = await updateSwiftRecord({
        currentUser,
        swiftId,
        payload: parseSwiftPayloadValue(requestData.data),
      });
      return createApiSuccessResponse({
        data: {
          swift: result.data,
          validation: result.validation,
        },
        message: '修改已完成',
      }, request);
    }

    if (action === 'request-edit') {
      const swiftId = typeof requestData.swiftId === 'string' ? requestData.swiftId : '';
      const result = await requestSwiftEdit({
        currentUser,
        swiftId,
        data: parseSwiftPayloadValue(requestData.data),
      });
      return createApiSuccessResponse({
        data: result.data,
        message: result.message,
      }, request);
    }

    if (action === 'review-edit') {
      const requestId = typeof requestData.requestId === 'string' ? requestData.requestId : '';
      const decision = requestData.decision === 'approve' || requestData.decision === 'reject'
        ? requestData.decision
        : null;
      if (!requestId || !decision) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少审批参数',
          detail: { requestId, decision: requestData.decision },
        });
      }

      const result = await reviewSwiftEdit({
        currentUser,
        requestId,
        decision,
        comment: typeof requestData.comment === 'string' ? requestData.comment : null,
      });
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'mark-received') {
      const swiftId = typeof requestData.swiftId === 'string' ? requestData.swiftId : '';
      const result = await markSwiftReceived({
        currentUser,
        swiftId,
      });
      return createApiSuccessResponse({
        data: result.data,
        message: 'SWIFT已签收',
      }, request);
    }

    if (action === 'list-edit-requests') {
      const rows = await listSwiftEditRequests(currentUser);
      return NextResponse.json({ success: true, data: rows });
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
    logger.error('Swift API error', error);
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
