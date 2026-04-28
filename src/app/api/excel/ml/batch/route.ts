import { NextRequest } from 'next/server';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveExcelMlBatch } from '@/lib/excel-ml-service';
import {
  getExcelApiTokenIp,
  verifyExcelApiTokenFromHeader,
} from '@/lib/excel-token-service';

function parseLookupItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: 'items必须是数组',
    });
  }

  if (value.length === 0 || value.length > 500) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: 'items数量必须在1到500之间',
      detail: { count: value.length },
    });
  }

  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      orderNo: typeof row.orderNo === 'string' ? row.orderNo : String(row.orderNo ?? ''),
      field: Number(row.field),
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyExcelApiTokenFromHeader(
      request.headers.get('authorization'),
      getExcelApiTokenIp(request),
    );
    await enforceRateLimit('excelLookup', request, { currentUser: auth.user });

    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const items = parseLookupItems(body.items);
    const data = await resolveExcelMlBatch(auth.user, items);
    return createApiSuccessResponse({ data, message: 'Excel ML批量查询完成' }, request);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
}
