import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveOrderCustomerBatch } from '@/lib/order-customer-lookup-service';
import {
  getExcelApiTokenIp,
  verifyExcelApiTokenFromHeader,
} from '@/lib/excel-token-service';

const MAX_ORDER_LOOKUP_COUNT = 500;

function parseOrderNos(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: 'orderNos必须是数组',
    });
  }

  const orderNos = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (orderNos.length === 0 || orderNos.length > MAX_ORDER_LOOKUP_COUNT) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: `orderNos数量必须在1到${MAX_ORDER_LOOKUP_COUNT}之间`,
      detail: { count: orderNos.length },
    });
  }

  return orderNos;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await verifyExcelApiTokenFromHeader(
      request.headers.get('authorization'),
      getExcelApiTokenIp(request),
    );
    await enforceRateLimit('excelLookup', request, { currentUser: auth.user });

    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const result = await resolveOrderCustomerBatch(auth.user, parseOrderNos(body.orderNos));
    return createApiSuccessResponse({ data: result, message: 'ORDER NO客户资料批量查询完成' }, request);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
}
