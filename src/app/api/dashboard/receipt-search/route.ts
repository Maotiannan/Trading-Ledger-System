import { NextRequest, NextResponse } from 'next/server';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/route-auth';

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const orderNo = (searchParams.get('orderNo') || '').trim();
    const page = Number(searchParams.get('page') || '1');

    if (!orderNo) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: '请输入 ORDER NO',
      });
    }

    const data = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo, page });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error('Dashboard receipt search API error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
