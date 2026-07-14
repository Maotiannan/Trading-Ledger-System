import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import {
  getDashboardCustomerHistory,
  searchDashboardCustomers,
} from '@/lib/dashboard-customer-history-service';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/route-auth';
import { getUserPreferences } from '@/lib/user-preference-service';

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = (searchParams.get('action') || '').trim();

    if (action === 'search') {
      const data = await searchDashboardCustomers(currentUser, searchParams.get('query') || '');
      return NextResponse.json({ success: true, data });
    }

    if (action === 'history') {
      const preferences = await getUserPreferences(currentUser);
      const result = await getDashboardCustomerHistory(currentUser, {
        customerId: searchParams.get('customerId') || '',
        orderPage: searchParams.get('orderPage'),
        orderPageSize: searchParams.get('orderPageSize'),
        receiptPage: searchParams.get('receiptPage'),
        receiptPageSize: searchParams.get('receiptPageSize'),
        defaultOrderPageSize: preferences.listPageSizes.customerHistoryOrders,
        defaultReceiptPageSize: preferences.listPageSizes.customerHistoryReceipts,
      });
      return NextResponse.json({ success: true, data: result.data });
    }

    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '未知查询操作',
      detail: { action },
    });
  } catch (error) {
    logger.error('Dashboard customer history search API error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
