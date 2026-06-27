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

let mockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => {
    return (request: Request) => handler(request, mockCurrentUser);
  },
}));

jest.mock('@/lib/dashboard-receipt-search-service', () => ({
  searchDashboardReceiptsByOrderNo: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn() },
}));

import { GET } from '@/app/api/dashboard/receipt-search/route';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';

const mockSearch = searchDashboardReceiptsByOrderNo as jest.Mock;

describe('dashboard receipt search route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes authenticated search to the service', async () => {
    mockSearch.mockResolvedValueOnce({
      matched: true,
      inputOrderNo: 'PIKIN-20',
      matchedOrderNo: 'PIKIN-20',
      items: [],
      pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    });

    const response = await GET({ url: 'https://example.com/api/dashboard/receipt-search?orderNo=PIKIN-20&page=1' } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), { orderNo: 'PIKIN-20', page: 1 });
    expect(json.success).toBe(true);
    expect(json.data.matchedOrderNo).toBe('PIKIN-20');
  });

  it('rejects missing order number with a readable 400 error', async () => {
    const response = await GET({ url: 'https://example.com/api/dashboard/receipt-search?page=1' } as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
    expect(json.error).toBe('请输入 ORDER NO');
    expect(json.code).toBe('BAD_REQUEST');
  });
});
