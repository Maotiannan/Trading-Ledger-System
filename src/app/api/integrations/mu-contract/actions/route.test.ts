/** @jest-environment node */

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

jest.mock('@/lib/integrations/mu-contract-sync-service', () => {
  class MockSyncError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    MuContractSyncError: MockSyncError,
    runMuContractSyncNow: jest.fn(),
  };
});

jest.mock('@/lib/integrations/mu-contract-reconcile-service', () => ({
  previewMuContractReconcile: jest.fn(),
  applyMuContractReconcile: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));

import { POST } from '@/app/api/integrations/mu-contract/actions/route';
import {
  applyMuContractReconcile,
  previewMuContractReconcile,
} from '@/lib/integrations/mu-contract-reconcile-service';
import {
  MuContractSyncError,
  runMuContractSyncNow,
} from '@/lib/integrations/mu-contract-sync-service';

const mockSyncNow = runMuContractSyncNow as jest.Mock;
const mockPreview = previewMuContractReconcile as jest.Mock;
const mockApply = applyMuContractReconcile as jest.Mock;

function request(body: unknown, acceptLanguage = 'zh-CN'): Request {
  return new Request('https://example.test/api/integrations/mu-contract/actions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept-language': acceptLanguage,
    },
    body: JSON.stringify(body),
  });
}

describe('MU Contract administrator action route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentRole = UserRole.ADMIN;
    mockSyncNow.mockResolvedValue({ status: 'completed', processed: 1, conflicts: 0 });
    mockPreview.mockResolvedValue({
      previewId: 'preview-1',
      expiresAt: '2026-07-18T10:00:00.000Z',
      highWatermark: '1042',
      summary: { totalSourceRows: 53, metadataOnly: 39, creates: 14, manualOnlyUntouched: 10 },
    });
    mockApply.mockResolvedValue({ status: 'completed', processed: 53, conflicts: 0, highWatermark: '1042' });
  });

  it('rejects non-admin Sync Now', async () => {
    currentRole = UserRole.SALES;

    const response = await POST(request({ action: 'sync-now' }) as never);

    expect(response.status).toBe(403);
    expect(mockSyncNow).not.toHaveBeenCalled();
  });

  it('runs Sync Now as the authenticated administrator', async () => {
    const response = await POST(request({ action: 'sync-now' }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSyncNow).toHaveBeenCalledWith({ actorId: 'admin-1' });
    expect(json.data).toEqual(expect.objectContaining({ processed: 1 }));
  });

  it('returns readable 409 not-completed semantics when Sync Now is lease-contended', async () => {
    mockSyncNow.mockResolvedValueOnce({ status: 'running', processed: 0, conflicts: 0 });

    const response = await POST(request({ action: 'sync-now' }, 'en') as never);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json).toEqual(expect.objectContaining({
      success: false,
      code: 'CONFLICT',
      error: expect.stringMatching(/already running|not completed|正在运行|未完成/i),
    }));
  });

  it('returns the persisted Full Reconcile preview before apply', async () => {
    const response = await POST(request({ action: 'preview-reconcile' }) as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockPreview).toHaveBeenCalledWith('admin-1');
    expect(json.data).toEqual(expect.objectContaining({
      previewId: 'preview-1',
      summary: expect.objectContaining({ metadataOnly: 39, creates: 14 }),
    }));
  });

  it('requires a non-empty preview id for apply', async () => {
    const response = await POST(request({ action: 'apply-reconcile', previewId: '  ' }) as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual(expect.objectContaining({ success: false, code: 'BAD_REQUEST' }));
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('applies only the explicitly selected preview', async () => {
    const response = await POST(request({ action: 'apply-reconcile', previewId: 'preview-1' }) as never);

    expect(response.status).toBe(200);
    expect(mockApply).toHaveBeenCalledWith('admin-1', 'preview-1');
  });

  it('returns readable 409 not-completed semantics when reconcile apply is lease-contended', async () => {
    mockApply.mockResolvedValueOnce({
      status: 'running',
      processed: 0,
      conflicts: 0,
      highWatermark: '1042',
    });

    const response = await POST(request({
      action: 'apply-reconcile',
      previewId: 'preview-1',
    }, 'en') as never);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toEqual(expect.stringMatching(/already running|not completed|正在运行|未完成/i));
  });

  it('rejects unknown actions without invoking a service', async () => {
    const response = await POST(request({ action: 'force-overwrite', token: 'secret' }) as never);

    expect(response.status).toBe(400);
    expect(mockSyncNow).not.toHaveBeenCalled();
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('maps initial-reconcile gating to a readable conflict without leaking errors', async () => {
    mockSyncNow.mockRejectedValueOnce(
      new MuContractSyncError('MU_CONTRACT_INITIAL_RECONCILE_REQUIRED' as never),
    );

    const response = await POST(request({ action: 'sync-now', token: 'dedicated-secret' }) as never);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toEqual(expect.any(String));
    expect(JSON.stringify(json)).not.toContain('dedicated-secret');
    expect(JSON.stringify(json)).not.toContain('stack');
  });
});
