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
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => {
    return (request: Request) => handler(request, mockCurrentUser);
  },
}));

jest.mock('@/lib/customer-sync-service', () => ({
  syncCustomers: jest.fn(),
}));

import { GET } from '@/app/api/sync/customers/route';
import { syncCustomers } from '@/lib/customer-sync-service';

const mockSyncCustomers = syncCustomers as jest.Mock;

describe('sync customers route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes since and limit query parameters to customer sync service', async () => {
    mockSyncCustomers.mockResolvedValueOnce({
      data: {
        customers: [],
        deleted: [],
        disabled: [],
        nextCursor: 'next-cursor',
        hasMore: false,
      },
      message: '客户同步完成',
    });

    const response = await GET({
      url: 'https://example.com/api/sync/customers?since=cursor-1&limit=50',
      headers: { get: () => null },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSyncCustomers).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), {
      since: 'cursor-1',
      limit: '50',
    });
    expect(json.success).toBe(true);
    expect(json.data.nextCursor).toBe('next-cursor');
  });
});
