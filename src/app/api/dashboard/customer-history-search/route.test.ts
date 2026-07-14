jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      async json() {
        return body;
      },
    }),
  },
}));

const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  role: 'USER' as const,
  level: 4,
  parentId: 'sales-1',
  createdById: 'sales-1',
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, user: unknown) => Promise<unknown>) => (
    (request: Request) => handler(request, currentUser)
  ),
}));

jest.mock('@/lib/dashboard-customer-history-service', () => ({
  searchDashboardCustomers: jest.fn(),
  getDashboardCustomerHistory: jest.fn(),
}));

jest.mock('@/lib/user-preference-service', () => ({
  getUserPreferences: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { GET } from '@/app/api/dashboard/customer-history-search/route';
import {
  getDashboardCustomerHistory,
  searchDashboardCustomers,
} from '@/lib/dashboard-customer-history-service';
import { getUserPreferences } from '@/lib/user-preference-service';

const mockSearch = searchDashboardCustomers as jest.Mock;
const mockHistory = getDashboardCustomerHistory as jest.Mock;
const mockGetUserPreferences = getUserPreferences as jest.Mock;

describe('dashboard customer history search route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserPreferences.mockResolvedValue({
      listPageSizes: { customerHistoryOrders: 10, customerHistoryReceipts: 10 },
    });
  });

  it('searches only after an explicit search action', async () => {
    mockSearch.mockResolvedValue({ query: 'PIKIN', items: [] });

    const response = await GET({
      url: 'https://example.com/api/dashboard/customer-history-search?action=search&query=PIKIN',
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(currentUser, 'PIKIN');
    expect(json.data.items).toEqual([]);
  });

  it('loads all ORDER_NAME history for the selected visible customer', async () => {
    mockHistory.mockResolvedValue({ data: { orderNames: ['MAB-1', 'MARY'], orders: [], receipts: [] } });

    const response = await GET({
      url: 'https://example.com/api/dashboard/customer-history-search?action=history&customerId=customer-1&orderPage=2&receiptPage=3',
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockHistory).toHaveBeenCalledWith(currentUser, {
      customerId: 'customer-1',
      orderPage: '2',
      orderPageSize: null,
      receiptPage: '3',
      receiptPageSize: null,
      defaultOrderPageSize: 10,
      defaultReceiptPageSize: 10,
    });
    expect(json.data.orderNames).toEqual(['MAB-1', 'MARY']);
  });

  it('returns a readable error for an unknown action', async () => {
    const response = await GET({
      url: 'https://example.com/api/dashboard/customer-history-search?action=unknown',
    } as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
  });
});
