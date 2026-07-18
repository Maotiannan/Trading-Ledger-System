import { UserRole } from '@prisma/client';

let currentRole: UserRole = UserRole.ADMIN;

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

jest.mock('@/lib/route-auth', () => ({
  withRole: (roles: UserRole | UserRole[], handler: (request: Request, user: unknown) => Promise<unknown>) => (
    async (request: Request) => {
      const allowed = Array.isArray(roles) ? roles : [roles];
      if (!allowed.includes(currentRole)) {
        return {
          status: 403,
          async json() {
            return { success: false, code: 'FORBIDDEN', error: '无权限' };
          },
        };
      }
      return handler(request, {
        id: 'admin-1',
        role: currentRole,
        email: 'admin@example.com',
        level: 1,
      });
    }
  ),
}));

jest.mock('@/lib/integrations/mu-contract-sync-service', () => ({
  getMuContractSyncStatus: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { GET } from '@/app/api/integrations/mu-contract/status/route';
import { getMuContractSyncStatus } from '@/lib/integrations/mu-contract-sync-service';

const mockStatus = getMuContractSyncStatus as jest.Mock;

describe('MU Contract integration status route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = UserRole.ADMIN;
    mockStatus.mockResolvedValue({
      enabled: false,
      intervalSeconds: 30,
      batchSize: 100,
      committedCursor: null,
      unmatchedCount: 0,
      conflictCount: 0,
      running: false,
    });
  });

  it('returns integration status to ADMIN without environment secrets', async () => {
    const response = await GET({ headers: new Headers() } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ intervalSeconds: 30, batchSize: 100 }),
    }));
    expect(JSON.stringify(json)).not.toMatch(/TOKEN|Authorization|Bearer/);
  });

  it.each([UserRole.SALES, UserRole.USER])('rejects %s accounts', async (role) => {
    currentRole = role;

    const response = await GET({ headers: new Headers() } as never);

    expect(response.status).toBe(403);
    expect(mockStatus).not.toHaveBeenCalled();
  });
});
