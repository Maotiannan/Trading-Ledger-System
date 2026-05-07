import { NextRequest, NextResponse } from 'next/server';
import { UploadedAssetCategory } from '@prisma/client';
import { ReceiptStatus } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { recognizeReceipt } from '@/lib/ocr';
import { withAuth } from '@/lib/route-auth';
import { UploadValidationError } from '@/lib/upload';
import { assertSearchLength, InputValidationError, parseJsonWithSchema, receiptPayloadSchema } from '@/lib/validators';
import { parseActionRequest } from '@/lib/http-body';
import { toOcrDataUrl } from '@/lib/ocr-input';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { buildReceiptBalanceAfterMap } from '@/lib/receipt-balance';
import { normalizeReceiptOcrResult } from '@/lib/receipt-normalization';
import { stageUploadedAsset } from '@/lib/uploaded-asset-service';
import {
  createReceiptRecord,
  markReceiptReceived,
  updateReceiptRecord,
} from '@/lib/receipt-service';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';
import {
  listReceiptEditRequests,
  requestReceiptEdit,
  reviewReceiptEdit,
} from '@/lib/receipt-edit-request-service';

const receiptEditablePatchSchema = z.object({
  receiptNo: z.string().nullable(),
  date: z.string().nullable(),
  orderNo: z.string().nullable(),
  invNo: z.string().nullable(),
  customerMark: z.string().nullable(),
  payer: z.string().nullable(),
  tel: z.string().nullable(),
});

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

function parseReceiptEditablePatch(data: Record<string, unknown>): ReceiptEditablePatch {
  if (typeof data.data === 'string') {
    return parseJsonWithSchema(data.data, receiptEditablePatchSchema, '收据修改数据格式错误');
  }

  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const nestedResult = receiptEditablePatchSchema.safeParse(data.data);
    if (!nestedResult.success) {
      const issue = nestedResult.error.issues[0];
      throw new InputValidationError(issue?.message || '收据修改数据格式错误');
    }
    return nestedResult.data;
  }

  const result = receiptEditablePatchSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InputValidationError(issue?.message || '收据修改数据格式错误');
  }
  return result.data;
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const statuses = searchParams.getAll('status').map((value) => value.trim()).filter(Boolean) as ReceiptStatus[];
    const singleStatus = searchParams.get('status') as ReceiptStatus | null;
    const search = searchParams.get('search') || '';
    const orderId = searchParams.get('orderId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const minUsd = searchParams.get('minUsd');
    const maxUsd = searchParams.get('maxUsd');

    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
    const filters: Record<string, unknown>[] = [
      buildReceiptVisibilityWhere(ownerIds),
    ];

    if (statuses.length > 0) {
      filters.push({ status: { in: statuses } });
    } else if (singleStatus) {
      filters.push({ status: singleStatus });
    }
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
        order: {
          include: {
            invoice: { select: { id: true, invNo: true } },
          },
        },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const orderIds = Array.from(new Set(
      receipts
        .map((receipt) => receipt.orderId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ));
    const balanceMap = new Map<string, number | null>();
    if (orderIds.length > 0) {
      const orderAmounts = new Map<string, number>();
      for (const receipt of receipts) {
        if (!receipt.orderId || !receipt.order) continue;
        orderAmounts.set(receipt.orderId, Number(receipt.order.amount));
      }
      const orderReceipts = await db.receipt.findMany({
        where: {
          orderId: { in: orderIds },
          ...buildReceiptVisibilityWhere(ownerIds),
        },
        select: {
          id: true,
          orderId: true,
          usd: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const computed = buildReceiptBalanceAfterMap(
        orderReceipts.map((row) => ({
          ...row,
          usd: Number(row.usd),
        })),
        orderAmounts,
      );
      for (const [receiptId, value] of computed.entries()) balanceMap.set(receiptId, value);
    }

    const enrichedReceipts = receipts.map((receipt) => ({
      ...receipt,
      balanceAfter: balanceMap.get(receipt.id) ?? null,
    }));

    return NextResponse.json({ success: true, data: filterRowsBySearch(enrichedReceipts, search) });
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
      await enforceRateLimit('upload', request, { currentUser });
      if (!file) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '请上传图片',
        });
      }

      try {
        const base64 = await toOcrDataUrl(file);
        const ocrResult = normalizeReceiptOcrResult(await recognizeReceipt(base64) as unknown as Record<string, unknown>);
        const imagePath = await stageUploadedAsset({
          file,
          category: UploadedAssetCategory.RECEIPT_OCR,
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

    if (action === 'request-edit') {
      if (!receiptId) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少收据ID',
        });
      }
      const result = await requestReceiptEdit({
        currentUser,
        receiptId,
        data: parseReceiptEditablePatch(data),
      });
      return createApiSuccessResponse({
        data: result.data,
        message: result.message,
      }, request);
    }

    if (action === 'review-edit') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const decision = data.decision === 'approve' || data.decision === 'reject'
        ? data.decision
        : null;
      if (!requestId) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少申请ID',
        });
      }
      if (!decision) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '缺少审批动作',
        });
      }

      const result = await reviewReceiptEdit({
        currentUser,
        requestId,
        decision,
        comment: typeof data.comment === 'string' ? data.comment : null,
      });
      return createApiSuccessResponse({
        message: result.message,
      }, request);
    }

    if (action === 'list-edit-requests') {
      const rows = await listReceiptEditRequests(currentUser);
      return createApiSuccessResponse({
        data: rows,
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

      const payload = parseReceiptEditablePatch(data);
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
