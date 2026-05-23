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

const mockUser = {
  id: 'sales-1',
  email: 'sales@example.com',
  name: 'Sales',
  role: 'SALES' as const,
  level: 3,
  parentId: 'admin-1',
  createdById: 'admin-1',
};

jest.mock('@/lib/excel-token-service', () => ({
  getExcelApiTokenIp: jest.fn(() => '127.0.0.1'),
  verifyExcelApiTokenFromHeader: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: jest.fn(),
}));

jest.mock('@/lib/order-customer-lookup-service', () => ({
  resolveOrderCustomerBatch: jest.fn(),
}));

import { POST } from '@/app/api/sync/customers/by-orders/route';
import { verifyExcelApiTokenFromHeader } from '@/lib/excel-token-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { resolveOrderCustomerBatch } from '@/lib/order-customer-lookup-service';

const mockVerify = verifyExcelApiTokenFromHeader as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;
const mockResolve = resolveOrderCustomerBatch as jest.Mock;

describe('sync customers by order route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockResolvedValue({ user: mockUser, tokenId: 'token-1' });
    mockResolve.mockResolvedValue({
      results: [{ success: true, orderNo: 'GANDO-10', customer: { id: 'customer-1' } }],
      count: 1,
      successCount: 1,
      failureCount: 0,
    });
  });

  it('authenticates with Excel token and passes orderNos to the lookup service', async () => {
    const request = {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer ml_token' : null),
      },
      text: async () => JSON.stringify({ orderNos: ['GANDO-10', 'SUPERDT2-09'] }),
    };

    const response = await POST(request as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith('Bearer ml_token', '127.0.0.1');
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('excelLookup', request, { currentUser: mockUser });
    expect(mockResolve).toHaveBeenCalledWith(mockUser, ['GANDO-10', 'SUPERDT2-09']);
    expect(json.success).toBe(true);
    expect(json.data.count).toBe(1);
  });
});
