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

jest.mock('@/lib/customer-consignee-service', () => ({
  writeOrderConsignee: jest.fn(),
}));

import { POST } from '@/app/api/customers/order-consignee/write/route';
import { verifyExcelApiTokenFromHeader } from '@/lib/excel-token-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { writeOrderConsignee } from '@/lib/customer-consignee-service';

const mockVerify = verifyExcelApiTokenFromHeader as jest.Mock;
const mockEnforceRateLimit = enforceRateLimit as jest.Mock;
const mockWrite = writeOrderConsignee as jest.Mock;

describe('customers order consignee write route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockResolvedValue({ user: mockUser, tokenId: 'token-1' });
    mockWrite.mockResolvedValue({
      written: true,
      orderNo: 'AB-12',
      customerId: 'customer-1',
      consigneeId: 'consignee-1',
      consignee: 'Alpha Consignee',
      updatedAt: '2026-05-25T00:00:00.000Z',
    });
  });

  it('uses Excel token auth and returns the direct write payload', async () => {
    const request = {
      headers: {
        get: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer ml_token' : null),
      },
      text: async () => JSON.stringify({ orderNo: 'AB-12', consignee: 'Alpha Consignee' }),
    };

    const response = await POST(request as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith('Bearer ml_token', '127.0.0.1');
    expect(mockEnforceRateLimit).toHaveBeenCalledWith('excelLookup', request, { currentUser: mockUser });
    expect(mockWrite).toHaveBeenCalledWith(mockUser, { orderNo: 'AB-12', consignee: 'Alpha Consignee' });
    expect(json).toEqual(expect.objectContaining({
      written: true,
      orderNo: 'AB-12',
      customerId: 'customer-1',
      consigneeId: 'consignee-1',
    }));
  });
});
