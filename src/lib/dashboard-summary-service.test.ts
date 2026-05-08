import { db } from '@/lib/db';
import { listDeletionRequests } from '@/lib/deletion-service';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { getOwnerVisibleIds } from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    receipt: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    detail: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/deletion-service', () => ({
  listDeletionRequests: jest.fn(),
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
  receipt: { count: jest.Mock; findMany: jest.Mock };
  detail: { count: jest.Mock; findMany: jest.Mock };
};
const mockListDeletionRequests = listDeletionRequests as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;

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
    mockDb.invoice.count.mockResolvedValue(2);
    mockDb.receipt.count.mockResolvedValue(1);
    mockDb.detail.count.mockResolvedValue(1);
    mockDb.receipt.findMany.mockResolvedValue([]);
    mockDb.detail.findMany.mockResolvedValue([]);
    mockListDeletionRequests.mockResolvedValue([{ status: 'PENDING' }, { status: 'APPROVED' }]);
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
            customerName: 'super dt2',
            customerMark: 'SDT2',
            amount: 1000,
            receipts: [{ usd: 250 }],
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
            customerName: 'mab-1',
            customerMark: 'MAB-1',
            amount: 500,
            receipts: [{ usd: 500 }],
          },
        ],
      },
    ]);

    const summary = await getDashboardSummary(makeUser() as never);

    expect(summary.unpaidTotal).toBe(750);
    expect(summary.pendingDeletion).toBe(1);
    expect(summary.releasedInvoices).toEqual([
      {
        id: 'invoice-1',
        invNo: 'L25MH090002',
        releaseDate: '2026-05-01T00:00:00.000Z',
        daysSinceRelease: 7,
        outstanding: 750,
      },
    ]);
    expect(summary.customerOutstanding).toEqual([
      {
        customerKey: 'SUPER DT2',
        customerLabel: 'SUPER DT2',
        totalOutstanding: 750,
        orders: [
          {
            orderId: 'order-1',
            orderNo: 'SUPER DT2-09',
            invNo: 'L25MH090002',
            outstanding: 750,
          },
        ],
      },
    ]);
  });
});
