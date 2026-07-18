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

jest.mock('@/lib/integrations/mu-contract-sync-service', () => ({
  runScheduledMuContractSync: jest.fn(),
}));

jest.mock('@/lib/security-config', () => ({
  requireProductionSecret: jest.fn(() => 'expected-maintenance-token'),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { POST } from '@/app/api/internal/integrations/mu-contract/pull/route';
import { runScheduledMuContractSync } from '@/lib/integrations/mu-contract-sync-service';

const mockScheduled = runScheduledMuContractSync as jest.Mock;

function request(token?: string): Request {
  return {
    headers: {
      get: (name: string) => (
        name.toLowerCase() === 'x-maintenance-token' ? token ?? null : null
      ),
    },
  } as unknown as Request;
}

describe('MU Contract scheduled pull route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduled.mockResolvedValue({ status: 'completed', processed: 1, conflicts: 0 });
  });

  it('requires the existing maintenance token', async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mockScheduled).not.toHaveBeenCalled();
  });

  it('runs only the scheduled synchronization path with a valid token', async () => {
    const response = await POST(request('expected-maintenance-token'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockScheduled).toHaveBeenCalledWith();
    expect(json.data.status).toBe('completed');
  });

  it('returns a generic failure without upstream diagnostics', async () => {
    mockScheduled.mockRejectedValueOnce(new Error('Bearer dedicated-secret at source-url'));

    const response = await POST(request('expected-maintenance-token'));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain('dedicated-secret');
    expect(JSON.stringify(json)).not.toContain('source-url');
  });
});
