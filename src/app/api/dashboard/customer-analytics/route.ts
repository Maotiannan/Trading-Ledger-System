import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import {
  getCustomerAnalyticsDetail,
  getCustomerAnalyticsRanking,
} from '@/lib/customer-analytics-service';
import type { CustomerAnalyticsMetric } from '@/lib/customer-analytics-types';
import { getAppYear } from '@/lib/app-time';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/route-auth';

const customerAnalyticsMetrics = [
  'annual-amount',
  'payment-capacity',
  'payment-cycle',
] as const satisfies readonly CustomerAnalyticsMetric[];

function parseMetric(value: string | null): CustomerAnalyticsMetric {
  const metric = String(value || '').trim() as CustomerAnalyticsMetric;
  if (!customerAnalyticsMetrics.includes(metric)) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '未知客户分析指标',
      detail: { metric: value },
    });
  }
  return metric;
}

function parseAnnualYear(metric: CustomerAnalyticsMetric, value: string | null): number | undefined {
  if (metric !== 'annual-amount') return undefined;
  if (!value?.trim()) return getAppYear();
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '年度下单金额排行需要有效年份',
      detail: { year: value },
    });
  }
  return year;
}

function parseDetailAsOf(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const asOf = new Date(value);
  if (!Number.isFinite(asOf.getTime())) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '客户分析时间无效',
      detail: { asOf: value },
    });
  }
  return asOf;
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = String(searchParams.get('action') || '').trim();
    if (action !== 'ranking' && action !== 'detail') {
      throw createApiError({
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: '未知客户分析操作',
        detail: { action },
      });
    }

    const metric = parseMetric(searchParams.get('metric'));
    const year = parseAnnualYear(metric, searchParams.get('year'));
    if (action === 'ranking') {
      const data = await getCustomerAnalyticsRanking(currentUser, {
        metric,
        ...(year === undefined ? {} : { year }),
      });
      return NextResponse.json({ success: true, data });
    }

    const customerId = String(searchParams.get('customerId') || '').trim();
    if (!customerId) {
      throw createApiError({
        code: apiErrorCodes.BAD_REQUEST,
        status: 400,
        message: '缺少客户',
      });
    }
    const asOf = parseDetailAsOf(searchParams.get('asOf'));
    const data = await getCustomerAnalyticsDetail(currentUser, {
      metric,
      customerId,
      ...(year === undefined ? {} : { year }),
      ...(asOf === undefined ? {} : { asOf }),
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error('Dashboard customer analytics API error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
