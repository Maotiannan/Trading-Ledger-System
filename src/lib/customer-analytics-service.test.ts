import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import {
  calculateAnnualAmountRanking,
  calculatePaymentCapacityRanking,
  calculatePaymentCycleRanking,
} from '@/lib/customer-analytics';
import { getCustomerAnalyticsSettings } from '@/lib/customer-analytics-settings';
import { logger } from '@/lib/logger';
import {
  getCustomerAnalyticsDetail,
  getCustomerAnalyticsRanking,
} from '@/lib/customer-analytics-service';
import {
  buildCustomerVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    customer: { findMany: jest.fn(), findFirst: jest.fn() },
    order: { findMany: jest.fn() },
    receipt: { count: jest.fn() },
  },
}));

jest.mock('@/lib/customer-analytics', () => {
  const actual = jest.requireActual('@/lib/customer-analytics');
  return {
    ...actual,
    calculateAnnualAmountRanking: jest.fn(),
    calculatePaymentCapacityRanking: jest.fn(),
    calculatePaymentCycleRanking: jest.fn(),
  };
});

jest.mock('@/lib/customer-analytics-settings', () => ({
  getCustomerAnalyticsSettings: jest.fn(),
}));

jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn(),
  buildCustomerVisibilityWhere: jest.fn(),
  buildOrderVisibilityWhere: jest.fn(),
  buildReceiptVisibilityWhere: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockDb = db as unknown as {
  customer: { findMany: jest.Mock; findFirst: jest.Mock };
  order: { findMany: jest.Mock };
  receipt: { count: jest.Mock };
};
const mockAnnual = calculateAnnualAmountRanking as jest.Mock;
const mockCapacity = calculatePaymentCapacityRanking as jest.Mock;
const mockCycle = calculatePaymentCycleRanking as jest.Mock;
const mockGetSettings = getCustomerAnalyticsSettings as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;
const mockBuildCustomerWhere = buildCustomerVisibilityWhere as jest.Mock;
const mockBuildOrderWhere = buildOrderVisibilityWhere as jest.Mock;
const mockBuildReceiptWhere = buildReceiptVisibilityWhere as jest.Mock;
const mockInfo = logger.info as jest.Mock;

const currentUser = {
  id: 'user-a',
  email: 'user-a@example.com',
  name: 'User A',
  role: UserRole.USER,
  level: 4,
  parentId: 'sales-a',
  createdById: 'sales-a',
};

const settings = {
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
};

const quality = {
  missingReleaseDateOrders: 0,
  missingReleaseDateAmount: 0,
  receiptDateFallbacks: 0,
  unboundReceipts: 0,
  invalidOrderAmounts: 0,
  invalidReceiptAmounts: 0,
  futureDatedReceipts: 0,
};

const customerRow = {
  id: 'customer-a',
  companyName: 'Alpha SARL',
  name: 'Alpha Person',
  mark: 'ALPHA',
};

const asOf = new Date('2026-07-15T12:00:00.000Z');
const period = {
  start: new Date('2025-07-01T00:00:00.000Z'),
  endExclusive: new Date('2026-07-01T00:00:00.000Z'),
};

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-a',
    customerId: 'customer-a',
    orderNo: 'ALPHA-01',
    amount: '12000.00',
    invoice: {
      invNo: 'INV-A',
      releaseDate: new Date('2026-01-10T00:00:00.000Z'),
    },
    receipts: [],
    ...overrides,
  };
}

describe('customer analytics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['sales-a', 'user-a']);
    mockBuildCustomerWhere.mockReturnValue({ ownerId: { in: ['sales-a', 'user-a'] } });
    mockBuildOrderWhere.mockReturnValue({ createdBy: { in: ['sales-a', 'user-a'] } });
    mockBuildReceiptWhere.mockReturnValue({ createdBy: { in: ['sales-a', 'user-a'] } });
    mockGetSettings.mockResolvedValue(settings);
    mockDb.customer.findMany.mockResolvedValue([customerRow]);
    mockDb.customer.findFirst.mockResolvedValue(customerRow);
    mockDb.order.findMany.mockResolvedValue([orderRow()]);
    mockDb.receipt.count.mockResolvedValue(0);
  });

  it('bulk-loads an annual ranking without selecting receipt payloads', async () => {
    mockAnnual.mockReturnValue({
      period: {
        start: new Date('2026-01-01T00:00:00.000Z'),
        endExclusive: new Date('2027-01-01T00:00:00.000Z'),
      },
      availableYears: [2025, 2026],
      items: [{ rank: 1, customerId: 'customer-a', customerName: 'Alpha SARL', mark: 'ALPHA', value: 12000 }],
      detailsByCustomer: { 'customer-a': { customerId: 'customer-a', total: 12000, orders: [] } },
      quality,
    });

    const result = await getCustomerAnalyticsRanking(currentUser, {
      metric: 'annual-amount',
      year: 2026,
      asOf,
    });

    expect(mockGetOwnerVisibleIds).toHaveBeenCalledWith(currentUser);
    expect(mockDb.customer.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.order.findMany).toHaveBeenCalledTimes(1);
    const orderQuery = mockDb.order.findMany.mock.calls[0][0];
    expect(orderQuery.where).toEqual({ createdBy: { in: ['sales-a', 'user-a'] } });
    expect(orderQuery.select.receipts).toBeUndefined();
    expect(mockDb.receipt.count).not.toHaveBeenCalled();
    expect(mockAnnual).toHaveBeenCalledWith({
      customers: [customerRow],
      orders: [expect.objectContaining({
        id: 'order-a',
        invNo: 'INV-A',
        releaseDate: new Date('2026-01-10T00:00:00.000Z'),
        receipts: [],
      })],
      year: 2026,
    });
    expect(result).toEqual(expect.objectContaining({
      metric: 'annual-amount',
      asOf: '2026-07-15T12:00:00.000Z',
      settings,
      period: {
        start: '2026-01-01T00:00:00.000Z',
        endExclusive: '2027-01-01T00:00:00.000Z',
      },
      availableYears: [2025, 2026],
      totalVisibleCustomers: 1,
      totalResultCustomers: 1,
      quality,
    }));
    expect(result).not.toHaveProperty('detailsByCustomer');
  });

  it('selects only required receipt fields, keeps special invoices, and merges unbound quality', async () => {
    const receiptDate = new Date('2026-06-15T00:00:00.000Z');
    mockDb.order.findMany.mockResolvedValue([
      orderRow({
        invoice: { invNo: 'DEPOSIT_POOL', releaseDate: null },
        receipts: [{
          id: 'receipt-a',
          usd: '12000.00',
          status: 'RECEIVED',
          date: receiptDate,
          createdAt: new Date('2026-06-16T08:00:00.000Z'),
          isDeposit: true,
        }],
      }),
    ]);
    mockDb.receipt.count.mockResolvedValue(2);
    mockCapacity.mockReturnValue({
      period,
      items: [{ rank: 1, customerId: 'customer-a', customerName: 'Alpha SARL', mark: 'ALPHA', value: 1000 }],
      detailsByCustomer: {},
      quality,
    });

    const result = await getCustomerAnalyticsRanking(currentUser, {
      metric: 'payment-capacity',
      asOf,
    });

    const orderQuery = mockDb.order.findMany.mock.calls[0][0];
    expect(orderQuery.select.receipts).toEqual({
      where: { createdBy: { in: ['sales-a', 'user-a'] } },
      select: {
        id: true,
        usd: true,
        status: true,
        date: true,
        createdAt: true,
        isDeposit: true,
      },
    });
    expect(mockCapacity).toHaveBeenCalledWith({
      customers: [customerRow],
      orders: [expect.objectContaining({
        invNo: 'DEPOSIT_POOL',
        receipts: [expect.objectContaining({ id: 'receipt-a', isDeposit: true })],
      })],
      asOf,
      settings,
    });
    expect(mockDb.receipt.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { createdBy: { in: ['sales-a', 'user-a'] } },
          { OR: [{ orderId: null }, { order: { customerId: null } }] },
        ],
      },
    });
    expect(result.quality.unboundReceipts).toBe(2);
    expect(result).not.toHaveProperty('detailsByCustomer');
  });

  it('dispatches payment-cycle calculation with one fixed server asOf', async () => {
    mockCycle.mockReturnValue({
      period,
      items: [{
        rank: 1,
        customerId: 'customer-a',
        customerName: 'Alpha SARL',
        mark: 'ALPHA',
        value: 52,
        rawValue: 52,
        roundedDays: 52,
        overdueOutstanding: 1000,
      }],
      detailsByCustomer: {},
      quality,
    });

    const result = await getCustomerAnalyticsRanking(currentUser, {
      metric: 'payment-cycle',
      asOf,
    });

    expect(mockCycle).toHaveBeenCalledWith(expect.objectContaining({ asOf, settings }));
    expect(result.asOf).toBe(asOf.toISOString());
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(
      'Customer analytics ranking calculated',
      expect.objectContaining({
        metric: 'payment-cycle',
        visibleCustomers: 1,
        visibleOrders: 1,
        resultCustomers: 1,
        quality: expect.any(Object),
        durationMs: expect.any(Number),
      }),
    );
    const rankingLog = mockInfo.mock.calls.find(
      ([message]) => message === 'Customer analytics ranking calculated',
    )?.[1];
    expect(rankingLog?.quality).not.toHaveProperty('missingReleaseDateAmount');
  });

  it('passes only rows returned by visibility-scoped bulk queries to the calculator', async () => {
    const customerScope = { ownerId: { in: ['user-a'] } };
    const orderScope = { createdBy: { in: ['user-a'] } };
    mockBuildCustomerWhere.mockReturnValue(customerScope);
    mockBuildOrderWhere.mockReturnValue(orderScope);
    mockDb.customer.findMany.mockImplementation(async ({ where }: { where: unknown }) => (
      where === customerScope ? [customerRow] : [customerRow, { ...customerRow, id: 'sibling-customer' }]
    ));
    mockDb.order.findMany.mockImplementation(async ({ where }: { where: unknown }) => (
      where === orderScope ? [orderRow()] : [orderRow(), orderRow({ id: 'sibling-order', customerId: 'sibling-customer' })]
    ));
    mockCapacity.mockReturnValue({ period, items: [], detailsByCustomer: {}, quality });

    await getCustomerAnalyticsRanking(currentUser, { metric: 'payment-capacity', asOf });

    expect(mockCapacity).toHaveBeenCalledWith(expect.objectContaining({
      customers: [customerRow],
      orders: [expect.objectContaining({ id: 'order-a' })],
    }));
  });

  it('independently checks customer visibility before loading detail evidence', async () => {
    mockAnnual.mockReturnValue({
      period: {
        start: new Date('2026-01-01T00:00:00.000Z'),
        endExclusive: new Date('2027-01-01T00:00:00.000Z'),
      },
      availableYears: [2026],
      items: [{ rank: 1, customerId: 'customer-a', customerName: 'Alpha SARL', mark: 'ALPHA', value: 12000 }],
      detailsByCustomer: {
        'customer-a': {
          customerId: 'customer-a',
          total: 12000,
          orders: [{
            orderId: 'order-a',
            orderNo: 'ALPHA-01',
            invNo: 'INV-A',
            releaseDate: new Date('2026-01-10T00:00:00.000Z'),
            amount: 12000,
          }],
        },
      },
      quality: { ...quality, missingReleaseDateAmount: 5000 },
    });

    const result = await getCustomerAnalyticsDetail(currentUser, {
      metric: 'annual-amount',
      customerId: 'customer-a',
      year: 2026,
      asOf,
    });

    expect(mockDb.customer.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: 'customer-a' },
          { ownerId: { in: ['sales-a', 'user-a'] } },
        ],
      },
      select: { id: true, companyName: true, name: true, mark: true },
    });
    expect(mockDb.customer.findMany).not.toHaveBeenCalled();
    expect(mockDb.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { customerId: 'customer-a' },
          { createdBy: { in: ['sales-a', 'user-a'] } },
        ],
      },
    }));
    expect(result).toEqual(expect.objectContaining({
      metric: 'annual-amount',
      asOf: asOf.toISOString(),
      customer: customerRow,
      value: 12000,
      detail: {
        customerId: 'customer-a',
        total: 12000,
        orders: [expect.objectContaining({
          orderNo: 'ALPHA-01',
          releaseDate: '2026-01-10T00:00:00.000Z',
        })],
      },
    }));
    const detailLog = mockInfo.mock.calls.find(
      ([message]) => message === 'Customer analytics detail calculated',
    )?.[1];
    expect(detailLog?.quality).not.toHaveProperty('missingReleaseDateAmount');
  });

  it('returns not found without querying orders for an out-of-scope customer', async () => {
    mockDb.customer.findFirst.mockResolvedValue(null);

    await expect(getCustomerAnalyticsDetail(currentUser, {
      metric: 'payment-cycle',
      customerId: 'sibling-customer',
      asOf,
    })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });

    expect(mockDb.order.findMany).not.toHaveBeenCalled();
    expect(mockCycle).not.toHaveBeenCalled();
  });

  it('keeps ranking and detail totals reconciled for unchanged source data', async () => {
    const actualAnalytics = jest.requireActual('@/lib/customer-analytics') as typeof import('@/lib/customer-analytics');
    const stableOrder = orderRow({
      amount: '12000.00',
      receipts: [{
        id: 'receipt-a',
        usd: '12000.00',
        status: 'RECEIVED',
        date: new Date('2026-06-15T00:00:00.000Z'),
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
        isDeposit: false,
      }],
    });
    mockDb.order.findMany.mockResolvedValue([stableOrder]);
    mockCapacity.mockImplementation(actualAnalytics.calculatePaymentCapacityRanking);

    const ranking = await getCustomerAnalyticsRanking(currentUser, {
      metric: 'payment-capacity',
      asOf,
    });
    const detail = await getCustomerAnalyticsDetail(currentUser, {
      metric: 'payment-capacity',
      customerId: 'customer-a',
      asOf,
    });

    expect(ranking.items[0].value).toBe(1000);
    expect(detail.value).toBe(ranking.items[0].value);
    expect(detail.detail).toEqual(expect.objectContaining({
      total: 12000,
      averageMonthly: 1000,
    }));
    expect(detail.asOf).toBe(ranking.asOf);
  });
});
