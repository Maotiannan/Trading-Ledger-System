import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-auth';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { logger } from '@/lib/logger';

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || '';

    if (action !== 'summary') {
      throw createApiError({
        code: 'INVALID_ACTION',
        status: 400,
        message: '未知操作',
        detail: { action },
      });
    }

    const summary = await getDashboardSummary(currentUser);
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    logger.error('Dashboard API error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
