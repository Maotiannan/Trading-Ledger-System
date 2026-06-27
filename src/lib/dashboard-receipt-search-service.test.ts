import { db } from '@/lib/db';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';
import { findMatchingOrder } from '@/lib/matching';
import { buildReceiptVisibilityWhere, getOwnerVisibleIds } from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    receipt: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/matching', () => ({
  findMatchingOrder: jest.fn(),
}));

jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn(),
  buildReceiptVisibilityWhere: jest.fn(),
}));

const mockFindMatchingOrder = findMatchingOrder as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;
const mockBuildReceiptVisibilityWhere = buildReceiptVisibilityWhere as jest.Mock;
const mockReceiptCount = db.receipt.count as jest.Mock;
const mockReceiptFindMany = db.receipt.findMany as jest.Mock;

const currentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

describe('searchDashboardReceiptsByOrderNo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['admin-1', 'sales-1']);
    mockBuildReceiptVisibilityWhere.mockReturnValue({ createdBy: { in: ['admin-1', 'sales-1'] } });
  });

  it('returns matched receipts by matched order id using fixed page size', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce({
      orderId: 'order-pikin-group',
      orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
      amount: 30000,
      orderBalance: 17869,
    });
    mockReceiptCount.mockResolvedValueOnce(11);
    mockReceiptFindMany.mockResolvedValueOnce(Array.from({ length: 11 }, (_, index) => ({
      id: `receipt-${index + 1}`,
      orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
      date: new Date(`2026-06-${String(30 - index).padStart(2, '0')}T00:00:00.000Z`),
      createdAt: new Date(`2026-06-${String(30 - index).padStart(2, '0')}T08:00:00.000Z`),
      usd: 2500 + index,
      status: 'SR_Received',
    })));

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'PIKIN-19B', page: 2 });

    expect(mockFindMatchingOrder).toHaveBeenCalledWith('PIKIN-19B');
    expect(mockReceiptCount).toHaveBeenCalledWith({
      where: {
        AND: [
          { createdBy: { in: ['admin-1', 'sales-1'] } },
          { orderId: 'order-pikin-group' },
        ],
      },
    });
    expect(mockReceiptFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { createdBy: { in: ['admin-1', 'sales-1'] } },
          { orderId: 'order-pikin-group' },
        ],
      },
      select: { id: true, orderNo: true, date: true, createdAt: true, usd: true, status: true },
    }));
    expect(result).toEqual({
      matched: true,
      inputOrderNo: 'PIKIN-19B',
      matchedOrderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
      items: [
        {
          id: 'receipt-11',
          orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
          date: '2026-06-20T00:00:00.000Z',
          amount: 2510,
          status: 'SR_Received',
        },
      ],
      pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 },
    });
  });

  it('sorts by receipt date with createdAt fallback before paginating', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce({ orderId: 'order-1', orderNo: 'AB-01', amount: 100, orderBalance: 0 });
    mockReceiptCount.mockResolvedValueOnce(3);
    mockReceiptFindMany.mockResolvedValueOnce([
      {
        id: 'receipt-old-date',
        orderNo: 'AB-01',
        date: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-30T10:00:00.000Z'),
        usd: 100,
        status: 'RECEIVED',
      },
      {
        id: 'receipt-new-created',
        orderNo: 'AB-01',
        date: null,
        createdAt: new Date('2026-06-25T10:00:00.000Z'),
        usd: 200,
        status: 'SR_Received',
      },
      {
        id: 'receipt-new-date',
        orderNo: 'AB-01',
        date: new Date('2026-06-28T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        usd: 300,
        status: 'Bank_Transfer',
      },
    ]);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'AB-01', page: 1 });

    expect(result.items.map((row) => row.id)).toEqual(['receipt-new-date', 'receipt-new-created', 'receipt-old-date']);
    expect(result.items.map((row) => row.date)).toEqual([
      '2026-06-28T00:00:00.000Z',
      '2026-06-25T10:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
    ]);
  });

  it('does not search raw receipts when order matching fails', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce(null);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'UNKNOWN-01', page: 1 });

    expect(mockReceiptCount).not.toHaveBeenCalled();
    expect(mockReceiptFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      matched: false,
      inputOrderNo: 'UNKNOWN-01',
      matchedOrderNo: null,
      items: [],
      pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    });
  });

  it('normalizes invalid pages back to page 1', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce({ orderId: 'order-1', orderNo: 'AB-01', amount: 100, orderBalance: 0 });
    mockReceiptCount.mockResolvedValueOnce(0);
    mockReceiptFindMany.mockResolvedValueOnce([]);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'AB-01', page: -20 });

    expect(result.pagination.page).toBe(1);
    expect(result.items).toEqual([]);
  });
});
