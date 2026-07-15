import type { Prisma } from '@prisma/client';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import {
  calculateAnnualAmountRanking,
  calculatePaymentCapacityRanking,
  calculatePaymentCycleRanking,
} from '@/lib/customer-analytics';
import { getCustomerAnalyticsSettings } from '@/lib/customer-analytics-settings';
import type {
  CustomerAnalyticsAnnualDetail,
  CustomerAnalyticsCapacityDetail,
  CustomerAnalyticsCycleDetail,
  CustomerAnalyticsDetailDto,
  CustomerAnalyticsDetailResponse,
  CustomerAnalyticsMetric,
  CustomerAnalyticsOrderInput,
  CustomerAnalyticsPeriod,
  CustomerAnalyticsQuality,
  CustomerAnalyticsRankingResponse,
  CustomerAnalyticsReceiptInput,
  CustomerAnalyticsSettings,
} from '@/lib/customer-analytics-types';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { CurrentUser } from '@/lib/request-auth';
import {
  buildCustomerVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

type CustomerAnalyticsRequest = {
  metric: CustomerAnalyticsMetric;
  year?: number;
  asOf?: Date;
};

type CustomerAnalyticsDetailRequest = CustomerAnalyticsRequest & {
  customerId: string;
};

type RawAnalyticsOrder = {
  id: string;
  customerId: string | null;
  orderNo: string;
  amount: CustomerAnalyticsOrderInput['amount'];
  invoice: {
    invNo: string;
    releaseDate: Date | null;
  };
  receipts?: CustomerAnalyticsReceiptInput[];
};

type AnalyticsCalculationResult = ReturnType<
  | typeof calculateAnnualAmountRanking
  | typeof calculatePaymentCapacityRanking
  | typeof calculatePaymentCycleRanking
>;

const customerIdentitySelect = {
  id: true,
  companyName: true,
  name: true,
  mark: true,
} as const satisfies Prisma.CustomerSelect;

const annualOrderSelect = {
  id: true,
  customerId: true,
  orderNo: true,
  amount: true,
  invoice: {
    select: {
      invNo: true,
      releaseDate: true,
    },
  },
} as const satisfies Prisma.OrderSelect;

const receiptCalculationSelect = {
  id: true,
  usd: true,
  status: true,
  date: true,
  createdAt: true,
  isDeposit: true,
} as const satisfies Prisma.ReceiptSelect;

function orderWithReceiptsSelect(receiptWhere: Prisma.ReceiptWhereInput): Prisma.OrderSelect {
  return {
    ...annualOrderSelect,
    receipts: {
      where: receiptWhere,
      select: receiptCalculationSelect,
    },
  };
}

function requireAnnualYear(metric: CustomerAnalyticsMetric, year: number | undefined): number | undefined {
  if (metric !== 'annual-amount') return undefined;
  if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 3000) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '年度下单金额排行需要有效年份',
      detail: { year },
    });
  }
  return year;
}

function fixedAsOf(value: Date | undefined): Date {
  const asOf = value ? new Date(value) : new Date();
  if (!Number.isFinite(asOf.getTime())) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '客户分析时间无效',
    });
  }
  return asOf;
}

function normalizeOrders(rows: RawAnalyticsOrder[], includeReceipts: boolean): CustomerAnalyticsOrderInput[] {
  return rows.map((row) => ({
    id: row.id,
    customerId: row.customerId,
    orderNo: row.orderNo,
    invNo: row.invoice.invNo,
    releaseDate: row.invoice.releaseDate,
    amount: row.amount,
    receipts: includeReceipts ? (row.receipts || []) : [],
  }));
}

function calculateMetric(input: {
  metric: CustomerAnalyticsMetric;
  customers: Parameters<typeof calculateAnnualAmountRanking>[0]['customers'];
  orders: CustomerAnalyticsOrderInput[];
  year?: number;
  asOf: Date;
  settings: CustomerAnalyticsSettings;
}): AnalyticsCalculationResult {
  if (input.metric === 'annual-amount') {
    return calculateAnnualAmountRanking({
      customers: input.customers,
      orders: input.orders,
      year: input.year!,
    });
  }
  if (input.metric === 'payment-capacity') {
    return calculatePaymentCapacityRanking({
      customers: input.customers,
      orders: input.orders,
      asOf: input.asOf,
      settings: input.settings,
    });
  }
  return calculatePaymentCycleRanking({
    customers: input.customers,
    orders: input.orders,
    asOf: input.asOf,
    settings: input.settings,
  });
}

function serializePeriod(period: CustomerAnalyticsPeriod): CustomerAnalyticsRankingResponse['period'] {
  return {
    start: period.start.toISOString(),
    endExclusive: period.endExclusive.toISOString(),
  };
}

function serializeDetail(metric: CustomerAnalyticsMetric, detail: unknown): CustomerAnalyticsDetailDto | null {
  if (!detail) return null;
  if (metric === 'annual-amount') {
    const annual = detail as CustomerAnalyticsAnnualDetail;
    return {
      ...annual,
      orders: annual.orders.map((order) => ({
        ...order,
        releaseDate: order.releaseDate.toISOString(),
      })),
    };
  }
  if (metric === 'payment-capacity') {
    const capacity = detail as CustomerAnalyticsCapacityDetail;
    return {
      ...capacity,
      months: capacity.months.map((month) => ({
        ...month,
        receipts: month.receipts.map((receipt) => ({
          ...receipt,
          effectiveDate: receipt.effectiveDate.toISOString(),
        })),
      })),
    };
  }
  const cycle = detail as CustomerAnalyticsCycleDetail;
  return {
    ...cycle,
    orders: cycle.orders.map((order) => ({
      ...order,
      releaseDate: order.releaseDate.toISOString(),
    })),
  };
}

function unboundReceiptCount(
  metric: CustomerAnalyticsMetric,
  receiptWhere: Prisma.ReceiptWhereInput,
): Promise<number> {
  if (metric === 'annual-amount') return Promise.resolve(0);
  return db.receipt.count({
    where: {
      AND: [
        receiptWhere,
        { OR: [{ orderId: null }, { order: { customerId: null } }] },
      ],
    },
  });
}

function combineScope<T extends Record<string, unknown>>(
  identity: T,
  scope: Record<string, unknown>,
): { AND: Array<T | Record<string, unknown>> } {
  return { AND: [identity, scope] };
}

function qualityForLog(quality: CustomerAnalyticsQuality) {
  return {
    missingReleaseDateOrders: quality.missingReleaseDateOrders,
    receiptDateFallbacks: quality.receiptDateFallbacks,
    unboundReceipts: quality.unboundReceipts,
    invalidOrderAmounts: quality.invalidOrderAmounts,
    invalidReceiptAmounts: quality.invalidReceiptAmounts,
    futureDatedReceipts: quality.futureDatedReceipts,
  };
}

export async function getCustomerAnalyticsRanking(
  currentUser: CurrentUser,
  request: CustomerAnalyticsRequest,
): Promise<CustomerAnalyticsRankingResponse> {
  const startedAt = Date.now();
  const asOf = fixedAsOf(request.asOf);
  const year = requireAnnualYear(request.metric, request.year);
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const customerWhere = buildCustomerVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const includeReceipts = request.metric !== 'annual-amount';

  const [settings, customers, rawOrders, unboundReceipts] = await Promise.all([
    getCustomerAnalyticsSettings(),
    db.customer.findMany({ where: customerWhere, select: customerIdentitySelect }),
    db.order.findMany({
      where: orderWhere,
      select: includeReceipts ? orderWithReceiptsSelect(receiptWhere) : annualOrderSelect,
    }),
    unboundReceiptCount(request.metric, receiptWhere),
  ]);
  const orders = normalizeOrders(rawOrders as RawAnalyticsOrder[], includeReceipts);
  const calculated = calculateMetric({
    metric: request.metric,
    customers,
    orders,
    year,
    asOf,
    settings,
  });
  const quality = { ...calculated.quality, unboundReceipts };
  const response: CustomerAnalyticsRankingResponse = {
    metric: request.metric,
    asOf: asOf.toISOString(),
    settings,
    period: serializePeriod(calculated.period),
    availableYears: 'availableYears' in calculated ? calculated.availableYears : [],
    quality,
    totalVisibleCustomers: customers.length,
    totalResultCustomers: calculated.items.length,
    items: calculated.items,
  };

  logger.info('Customer analytics ranking calculated', {
    metric: request.metric,
    durationMs: Date.now() - startedAt,
    visibleCustomers: customers.length,
    visibleOrders: orders.length,
    resultCustomers: calculated.items.length,
    quality: qualityForLog(quality),
  });
  return response;
}

export async function getCustomerAnalyticsDetail(
  currentUser: CurrentUser,
  request: CustomerAnalyticsDetailRequest,
): Promise<CustomerAnalyticsDetailResponse> {
  const startedAt = Date.now();
  const asOf = fixedAsOf(request.asOf);
  const year = requireAnnualYear(request.metric, request.year);
  const customerId = String(request.customerId || '').trim();
  if (!customerId) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '缺少客户',
    });
  }

  const ownerIds = await getOwnerVisibleIds(currentUser);
  const customerWhere = buildCustomerVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const customer = await db.customer.findFirst({
    where: combineScope({ id: customerId }, customerWhere as Record<string, unknown>),
    select: customerIdentitySelect,
  });
  if (!customer) {
    throw createApiError({
      code: apiErrorCodes.RESOURCE_NOT_FOUND,
      status: 404,
      message: '客户不存在或无权限',
    });
  }

  const includeReceipts = request.metric !== 'annual-amount';
  const [settings, rawOrders, unboundReceipts] = await Promise.all([
    getCustomerAnalyticsSettings(),
    db.order.findMany({
      where: combineScope({ customerId }, orderWhere as Record<string, unknown>),
      select: includeReceipts ? orderWithReceiptsSelect(receiptWhere) : annualOrderSelect,
    }),
    unboundReceiptCount(request.metric, receiptWhere),
  ]);
  const orders = normalizeOrders(rawOrders as RawAnalyticsOrder[], includeReceipts);
  const calculated = calculateMetric({
    metric: request.metric,
    customers: [customer],
    orders,
    year,
    asOf,
    settings,
  });
  const row = calculated.items.find((item) => item.customerId === customerId);
  const detail = calculated.detailsByCustomer[customerId];
  const quality = { ...calculated.quality, unboundReceipts };
  const response: CustomerAnalyticsDetailResponse = {
    metric: request.metric,
    asOf: asOf.toISOString(),
    settings,
    period: serializePeriod(calculated.period),
    availableYears: 'availableYears' in calculated ? calculated.availableYears : [],
    quality,
    customer,
    value: row?.value ?? 0,
    detail: serializeDetail(request.metric, detail),
  };

  logger.info('Customer analytics detail calculated', {
    metric: request.metric,
    durationMs: Date.now() - startedAt,
    visibleOrders: orders.length,
    hasResult: Boolean(row),
    quality: qualityForLog(quality),
  });
  return response;
}
