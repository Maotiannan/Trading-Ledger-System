import { NextRequest } from 'next/server';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { syncCustomers } from '@/lib/customer-sync-service';
import { withAuth } from '@/lib/route-auth';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const result = await syncCustomers(currentUser, {
      since: trimStr(searchParams.get('since')),
      limit: trimStr(searchParams.get('limit')),
    });
    return createApiSuccessResponse(result, request);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
