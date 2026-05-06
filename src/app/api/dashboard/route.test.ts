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

jest.mock('@/lib/dashboard-summary-service', () => ({
  getDashboardSummary: jest.fn(),
}));

import { GET } from '@/app/api/dashboard/route';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';

const mockGetDashboardSummary = getDashboardSummary as jest.Mock;

describe('dashboard summary route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns dashboard summary for summary action', async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      invoiceCount: 3,
      unpaidTotal: 1200,
      pendingReceipts: 4,
      waitingSwift: 2,
      pendingDeletion: 1,
      recentReceipts: [],
      recentDetails: [],
    });

    const response = await GET({ url: 'https://example.com/api/dashboard?action=summary' } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetDashboardSummary).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }));
    expect(json.success).toBe(true);
    expect(json.data.invoiceCount).toBe(3);
  });
});
