import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import {
  createReceiptGeneratorSession,
  finalizeReceiptGeneratorSession,
} from '@/lib/receipt-generator-service';
import {
  getSuggestedReceiptGeneratorNumber,
  getOpenReceiptGeneratorSessionByReceipt,
  getReceiptGeneratorSession,
  lookupReceiptGeneratorOrderContext,
} from '@/lib/receipt-generator-read-service';

function isUploadAbortError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error
    && (error.message === 'aborted' || ('code' in error && (error as NodeJS.ErrnoException).code === 'ECONNRESET'));
}

export const GET = withAuth(async (request, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || '';

    if (action === 'order-context') {
      const result = await lookupReceiptGeneratorOrderContext(
        currentUser,
        searchParams.get('orderNo') || '',
        searchParams.get('usdAmount') ? Number(searchParams.get('usdAmount')) : undefined,
      );
      return createApiSuccessResponse(result, request);
    }

    if (action === 'next-receipt-no') {
      const result = await getSuggestedReceiptGeneratorNumber(currentUser);
      return createApiSuccessResponse(result, request);
    }

    if (action === 'session') {
      const result = await getReceiptGeneratorSession(currentUser, searchParams.get('sessionId') || '');
      return createApiSuccessResponse(result, request);
    }

    if (action === 'resume-by-receipt') {
      const result = await getOpenReceiptGeneratorSessionByReceipt(currentUser, searchParams.get('receiptId') || '');
      return createApiSuccessResponse(result, request);
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({} as Record<string, unknown>));
      const action = typeof body.action === 'string' ? body.action : '';

      if (action === 'create-session') {
        const result = await createReceiptGeneratorSession(currentUser, {
          orderNo: typeof body.orderNo === 'string' ? body.orderNo : '',
          usdAmount: Number(body.usdAmount),
          paymentMode: typeof body.paymentMode === 'string' ? body.paymentMode : null,
        });
        return createApiSuccessResponse(result, request);
      }

      throw createApiError({
        code: 'INVALID_ACTION',
        status: 400,
        message: '未知操作',
        detail: { action },
      });
    }

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const action = String(formData.get('action') || '');

      if (action === 'finalize') {
        const receiptImage = formData.get('receiptImage');
        const receiverSignature = formData.get('receiverSignature');
        const payerSignature = formData.get('payerSignature');

        if (!(receiptImage instanceof File) || !(receiverSignature instanceof File) || !(payerSignature instanceof File)) {
          throw createApiError({
            code: 'BAD_REQUEST',
            status: 400,
            message: '签名或收据图片缺失',
          });
        }

        let layoutSnapshot: unknown = null;
        const rawSnapshot = formData.get('layoutSnapshot');
        if (typeof rawSnapshot === 'string' && rawSnapshot.trim()) {
          try {
            layoutSnapshot = JSON.parse(rawSnapshot);
          } catch {
            layoutSnapshot = rawSnapshot;
          }
        }

        const result = await finalizeReceiptGeneratorSession(currentUser, {
          sessionId: String(formData.get('sessionId') || ''),
          receiptImage,
          receiverSignature,
          payerSignature,
          layoutSnapshot,
        });
        return createApiSuccessResponse(result, request);
      }

      throw createApiError({
        code: 'INVALID_ACTION',
        status: 400,
        message: '未知操作',
        detail: { action },
      });
    }

    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '请求体格式错误',
    });
  } catch (error) {
    if (isUploadAbortError(error)) {
      console.error('Receipt generator finalize aborted:', {
        code: error.code || 'ABORTED',
      });
      return toApiErrorResponse(error, {
        code: apiErrorCodes.UPLOAD_ABORTED,
        status: 499,
        message: '上传中断，请在更稳定的网络下重试',
      }, request);
    }
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
