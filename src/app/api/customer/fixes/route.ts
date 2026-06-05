import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { withAuth } from '@/lib/route-auth';
import { listCustomerFixQueue } from '@/lib/customer-fix-read-service';
import { logger } from '@/lib/logger';
import {
  linkOrderCustomerFix,
  linkReceiptCustomerFix,
  parseFixCustomerPayload,
  resolveOrderCustomerFix,
  resolveReceiptCustomerFix,
} from '@/lib/customer-fix-service';

function trimStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function managerOnly(role: UserRole, request?: NextRequest): NextResponse | null {
  if (role === UserRole.ADMIN || role === UserRole.SALES) return null;
  return createApiErrorResponse({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' }, request);
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;
  const result = await listCustomerFixQueue(currentUser);
  return createApiSuccessResponse(result, request);
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;

  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const action = trimStr(body.action);

    if (!['resolve-order', 'resolve-receipt', 'link-order-customer', 'link-receipt-customer'].includes(action)) {
      return createApiErrorResponse({
        code: apiErrorCodes.INVALID_ACTION,
        status: 400,
        message: '未知操作',
        detail: { action },
      }, request);
    }

    if (action === 'link-order-customer') {
      const result = await linkOrderCustomerFix(currentUser, {
        orderId: trimStr(body.orderId),
        customerId: trimStr(body.customerId),
      });
      return createApiSuccessResponse(result, request);
    }

    if (action === 'link-receipt-customer') {
      const result = await linkReceiptCustomerFix(currentUser, {
        receiptId: trimStr(body.receiptId),
        customerId: trimStr(body.customerId),
      });
      return createApiSuccessResponse(result, request);
    }

    const parsed = parseFixCustomerPayload(body);
    if ('error' in parsed) {
      return createApiErrorResponse({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: parsed.error }, request);
    }

    if (action === 'resolve-order') {
      const result = await resolveOrderCustomerFix(currentUser, {
        orderId: trimStr(body.orderId),
        ownerId: trimStr(body.ownerId) || null,
        payload: parsed,
      });
      return createApiSuccessResponse(result, request);
    }

    const result = await resolveReceiptCustomerFix(currentUser, {
      receiptId: trimStr(body.receiptId),
      ownerId: trimStr(body.ownerId) || null,
      payload: parsed,
    });
    return createApiSuccessResponse(result, request);
  } catch (error) {
    logger.error('Customer fixes POST error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
