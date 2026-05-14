import { NextRequest } from 'next/server';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { parseJsonRequest } from '@/lib/http-body';
import {
  createOrderTracker,
  listOrderTrackerCustomerOptions,
  listOrderTrackers,
  updateOrderTracker,
} from '@/lib/order-tracker-service';
import { withAuth } from '@/lib/route-auth';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = trimStr(searchParams.get('action'));
    const search = trimStr(searchParams.get('search'));
    const status = trimStr(searchParams.get('status'));

    if (action === 'customer-options') {
      const result = await listOrderTrackerCustomerOptions(currentUser, { search });
      return createApiSuccessResponse(result, request);
    }

    const result = await listOrderTrackers(currentUser, { search, status });
    return createApiSuccessResponse(result, request);
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
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = trimStr(body.action);

    if (action === 'create') {
      const result = await createOrderTracker(currentUser, {
        orderNo: body.orderNo,
        customerId: body.customerId,
        status: body.status,
        remark: body.remark,
      });
      return createApiSuccessResponse(result, request);
    }

    if (action === 'update') {
      const result = await updateOrderTracker(currentUser, body.orderId, {
        status: body.status,
        piStatus: body.piStatus,
        remark: body.remark,
        systemNote: body.systemNote,
      });
      return createApiSuccessResponse(result, request);
    }

    throw new Error('未知操作');
  } catch (error) {
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
