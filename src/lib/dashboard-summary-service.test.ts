import { db } from '@/lib/db';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { getOwnerVisibleIds } from '@/lib/resource-visibility';
import { repairOrderBalanceCacheIfNeeded } from '@/lib/order-balance-service';

jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    receipt: {
      count: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    detail: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    deletionRequest: {
      count: jest.fn(),
    },
    receiptEditRequest: {
      count: jest.fn(),
    },
    detailEditRequest: {
      count: jest.fn(),
    },
    swiftEditRequest: {
      count: jest.fn(),
    },
  },
}));

jest.mock('@/lib/order-balance-service', () => ({
  repairOrderBalanceCacheIfNeeded: jest.fn().mockResolvedValue({ repaired: false }),
}));

jest.mock('@/lib/resource-visibility', () => ({
  buildDetailVisibilityWhere: jest.fn(() => ({})),
  buildInvoiceVisibilityWhere: jest.fn(() => ({})),
  buildOrderVisibilityWhere: jest.fn(() => ({})),
  buildReceiptVisibilityWhere: jest.fn(() => ({})),
  getOwnerVisibleIds: jest.fn(),
}));

const mockDb = db as unknown as {
  invoice: { count: jest.Mock; findMany: jest.Mock };
  receipt: { count: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
  detail: { count: jest.Mock; findMany: jest.Mock };
  deletionRequest: { count: jest.Mock };
  receiptEditRequest: { count: jest.Mock };
  detailEditRequest: { count: jest.Mock };
  swiftEditRequest: { count: jest.Mock };
};
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;
const mockRepairOrderBalanceCacheIfNeeded = repairOrderBalanceCacheIfNeeded as jest.Mock;

function makeUser() {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'ADMIN',
    level: 1,
    parentId: null,
    createdById: null,
  };
}

describe('dashboard-summary-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-08T00:00:00.000Z').getTime());
    mockGetOwnerVisibleIds.mockResolvedValue(['admin-1']);
    mockDb.invoice.count.mockResolvedValue(3);
    mockDb.receipt.count.mockResolvedValue(1);
    mockDb.receipt.aggregate.mockResolvedValue({ _sum: { usd: 9876.5 } });
    mockDb.detail.count.mockResolvedValue(1);
    mockDb.receipt.findMany.mockResolvedValue([]);
    mockDb.detail.findMany.mockResolvedValue([]);
    mockRepairOrderBalanceCacheIfNeeded.mockResolvedValue({ repaired: false });
    mockDb.deletionRequest.count.mockResolvedValue(1);
    mockDb.receiptEditRequest.count.mockResolvedValue(1);
    mockDb.detailEditRequest.count.mockResolvedValue(1);
    mockDb.swiftEditRequest.count.mockResolvedValue(2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns released unpaid invoices and uppercase customer outstanding groups', async () => {
    mockDb.invoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invNo: 'L25MH090002',
        releaseDate: new Date('2026-05-01T00:00:00.000Z'),
        orders: [
          {
            id: 'order-1',
            orderNo: 'Super Dt2-09',
            customerId: 'customer-super-dt2',
            customerName: 'super dt2',
            customerMark: 'SDT2',
            amount: 1000,
            orderBalance: 750,
            receipts: [{ usd: 250, status: 'SR_Received' }],
          },
        ],
      },
      {
        id: 'invoice-2',
        invNo: 'L25MH090003',
        releaseDate: new Date('2026-05-02T00:00:00.000Z'),
        orders: [
          {
            id: 'order-2',
            orderNo: 'MAB-1-10',
            customerId: 'customer-mab-1',
            customerName: 'mab-1',
            customerMark: 'MAB-1',
            amount: 500,
            orderBalance: 0,
            receipts: [{ usd: 500, status: 'RECEIVED' }],
          },
        ],
      },
      {
        id: 'invoice-3',
        invNo: 'L25MH090004',
        releaseDate: null,
        orders: [
          {
            id: 'order-3',
            orderNo: 'Super Dt2-10',
            customerId: 'customer-super-dt2',
            customerName: 'super dt2',
            customerMark: 'SDT2',
            amount: 250,
            orderBalance: 250,
            receipts: [],
          },
        ],
      },
    ]);

    const summary = await getDashboardSummary(makeUser() as never);

    expect(summary.unpaidTotal).toBe(1000);
    expect(summary.pendingReceiptsAmount).toBe(9876.5);
    expect(mockDb.receipt.aggregate).toHaveBeenCalledWith({
      where: {
        status: 'SR_Received',
      },
      _sum: { usd: true },
    });
    expect(summary.pendingDeletion).toBe(5);
    expect(mockDb.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        orders: expect.objectContaining({
          select: expect.objectContaining({
            receipts: expect.anything(),
          }),
        }),
      }),
    }));
    expect(mockDb.deletionRequest.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(mockDb.receiptEditRequest.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(mockDb.detailEditRequest.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(mockDb.swiftEditRequest.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(summary.releasedInvoices).toEqual([
      {
        id: 'invoice-1',
        invNo: 'L25MH090002',
        releaseDate: '2026-05-01T00:00:00.000Z',
        daysSinceRelease: 7,
        outstanding: 750,
        orders: [
          {
            orderId: 'order-1',
            orderNo: 'SUPER DT2-09',
            amount: 1000,
            outstanding: 750,
          },
        ],
      },
    ]);
    expect(summary.customerOutstanding).toEqual([
      {
        customerKey: 'customer:customer-super-dt2',
        customerLabel: 'SUPER DT2',
        totalOutstanding: 1000,
        statusSubtotals: {
          inTransit: 250,
          released: 750,
        },
        orders: [
          {
            orderId: 'order-3',
            orderNo: 'SUPER DT2-10',
            invNo: 'L25MH090004',
            outstanding: 250,
            statusGroup: 'IN_TRANSIT',
            releaseDate: null,
            daysSinceRelease: null,
          },
          {
            orderId: 'order-1',
            orderNo: 'SUPER DT2-09',
            invNo: 'L25MH090002',
            outstanding: 750,
            statusGroup: 'RELEASED',
            releaseDate: '2026-05-01T00:00:00.000Z',
            daysSinceRelease: 7,
          },
        ],
      },
    ]);
  });

  it('uses computed receipt balance when stored orderBalance is stale and schedules automatic repair', async () => {
    mockDb.invoice.findMany.mockResolvedValue([
      {
        id: 'invoice-super-dt2',
        invNo: 'L25MH070001',
        releaseDate: new Date('2026-07-02T00:00:00.000Z'),
        orders: [
          {
            id: 'order-super-dt2-07',
            orderNo: 'SUPER DT2-07',
            customerId: 'customer-super-dt2',
            customerName: 'super dt2',
            customerMark: 'SDT2',
            amount: 28674,
            orderBalance: 38674,
            receipts: [
              { usd: 10000, status: 'SR_Received' },
              { usd: 15000, status: 'RECEIVED' },
              { usd: 999, status: 'SIGNING_PENDING' },
            ],
          },
        ],
      },
    ]);

    const summary = await getDashboardSummary(makeUser() as never);

    expect(summary.unpaidTotal).toBe(3674);
    expect(summary.releasedInvoices).toEqual([
      expect.objectContaining({
        outstanding: 3674,
        orders: [expect.objectContaining({ outstanding: 3674 })],
      }),
    ]);
    expect(summary.customerOutstanding).toEqual([
      expect.objectContaining({
        totalOutstanding: 3674,
        statusSubtotals: { inTransit: 0, released: 3674 },
        orders: [expect.objectContaining({ outstanding: 3674 })],
      }),
    ]);
    expect(mockRepairOrderBalanceCacheIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-super-dt2-07',
        orderNo: 'SUPER DT2-07',
        orderBalance: 38674,
      }),
      expect.anything(),
      expect.objectContaining({
        actorId: 'admin-1',
        source: 'dashboard-summary',
      }),
    );
  });

});
