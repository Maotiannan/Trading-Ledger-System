import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { parseJsonRequest } from '@/lib/http-body';
import { enforceRateLimit } from '@/lib/rate-limit';
import { writeOrderConsignee } from '@/lib/customer-consignee-service';
import {
  getExcelApiTokenIp,
  verifyExcelApiTokenFromHeader,
} from '@/lib/excel-token-service';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await verifyExcelApiTokenFromHeader(
      request.headers.get('authorization'),
      getExcelApiTokenIp(request),
    );
    await enforceRateLimit('excelLookup', request, { currentUser: auth.user });

    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const result = await writeOrderConsignee(auth.user, {
      orderNo: body.orderNo,
      consignee: body.consignee,
    });
    return NextResponse.json(result);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
}
