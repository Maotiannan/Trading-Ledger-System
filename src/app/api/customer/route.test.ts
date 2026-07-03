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

const mockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => (
    (request: Request) => handler(request, mockCurrentUser)
  ),
}));

jest.mock('@/lib/customer-read-service', () => ({
  getCustomerOrderNameHistory: jest.fn(),
  listCustomerOwnerOptions: jest.fn(),
  listCustomers: jest.fn(),
}));

jest.mock('@/lib/user-preference-service', () => ({
  getUserPreferences: jest.fn(),
}));

jest.mock('@/lib/db', () => ({ db: {} }));

import { GET } from '@/app/api/customer/route';
import { getCustomerOrderNameHistory } from '@/lib/customer-read-service';
import { getUserPreferences } from '@/lib/user-preference-service';

const mockGetCustomerOrderNameHistory = getCustomerOrderNameHistory as jest.Mock;
const mockGetUserPreferences = getUserPreferences as jest.Mock;

describe('customer order history route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards independent pages and account page-size defaults to the service', async () => {
    mockGetUserPreferences.mockResolvedValueOnce({
      listPageSizes: {
        detail: 10,
        swift: 10,
        receipt: 20,
        customerHistoryOrders: 15,
        customerHistoryReceipts: 5,
      },
    });
    mockGetCustomerOrderNameHistory.mockResolvedValueOnce({
      data: {
        orders: [],
        receipts: [],
        orderPagination: { page: 2, pageSize: 15, totalItems: 0, totalPages: 1 },
        receiptPagination: { page: 3, pageSize: 20, totalItems: 0, totalPages: 1 },
      },
      message: 'loaded',
    });

    const response = await GET({
      url: 'https://example.com/api/customer?action=order-history&customerId=customer-1&orderName=MAB-1&orderPage=2&receiptPage=3&receiptPageSize=20',
      headers: { get: () => null },
    } as never);

    expect(response.status).toBe(200);
    expect(mockGetCustomerOrderNameHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      {
        customerId: 'customer-1',
        orderName: 'MAB-1',
        orderPage: '2',
        orderPageSize: null,
        receiptPage: '3',
        receiptPageSize: '20',
        defaultOrderPageSize: 15,
        defaultReceiptPageSize: 5,
      },
    );
  });
});
