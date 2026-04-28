import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveExcelMlValue } from '@/lib/excel-ml-service';
import {
  getExcelApiTokenIp,
  verifyExcelApiTokenFromHeader,
} from '@/lib/excel-token-service';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await verifyExcelApiTokenFromHeader(
      request.headers.get('authorization'),
      getExcelApiTokenIp(request),
    );
    await enforceRateLimit('excelLookup', request, { currentUser: auth.user });

    const { searchParams } = new URL(request.url);
    const orderNo = searchParams.get('orderNo') || '';
    const field = Number(searchParams.get('field'));
    const format = String(searchParams.get('format') || '').trim().toLowerCase();
    const result = await resolveExcelMlValue(auth.user, { orderNo, field });

    if (format === 'json') {
      return createApiSuccessResponse({ data: result, message: 'Excel ML查询完成' }, request);
    }

    return new NextResponse(result.value, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
}
