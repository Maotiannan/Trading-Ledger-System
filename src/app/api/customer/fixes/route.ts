import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { withAuth } from '@/lib/route-auth';
import {
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

  const [orders, receipts] = await Promise.all([
    db.order.findMany({
      where: {
        needsCustomerFix: true,
        ...(currentUser.role === UserRole.SALES ? { createdBy: currentUser.id } : {}),
      },
      include: {
        invoice: { select: { id: true, invNo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.receipt.findMany({
      where: {
        needsCustomerFix: true,
        ...(currentUser.role === UserRole.SALES ? { createdBy: currentUser.id } : {}),
      },
      select: {
        id: true,
        receiptNo: true,
        usd: true,
        status: true,
        orderNo: true,
        invNo: true,
        customerMark: true,
        customerName: true,
        customerPhone: true,
        customerCity: true,
        createdAt: true,
        orderId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  return NextResponse.json({ success: true, data: { orders, receipts } });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = trimStr(body.action);

    if (action !== 'resolve-order' && action !== 'resolve-receipt') {
      return createApiErrorResponse({
        code: apiErrorCodes.INVALID_ACTION,
        status: 400,
        message: '未知操作',
        detail: { action },
      }, request);
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
    console.error('Customer fixes POST error:', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
