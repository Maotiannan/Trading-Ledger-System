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
  withAuth: (handler: (request: Request, user: unknown) => Promise<unknown>) => handler,
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
        name: 'Admin',
        level: 1,
        parentId: null,
        createdById: null,
      });
    }
  ),
}));

jest.mock('@/lib/invoice-service', () => ({
  addInvoiceOrder: jest.fn(),
  assignInvoiceToBranchAdmin: jest.fn(),
  applyInvoiceRematch: jest.fn(),
  createInvoiceRecord: jest.fn(),
  deleteInvoiceOrder: jest.fn(),
  deleteInvoiceRecord: jest.fn(),
  parseDateInput: jest.fn(),
  previewInvoiceRematch: jest.fn(),
  processInvoiceImportRows: jest.fn(),
  rematchInvoices: jest.fn(),
  transferInvoiceBalance: jest.fn(),
  updateInvoiceDates: jest.fn(),
  updateInvoiceOrder: jest.fn(),
}));

jest.mock('@/lib/invoice-read-service', () => ({
  listInvoiceRecords: jest.fn(),
  lookupInvoiceOrderContext: jest.fn(),
  listOrderMatchCandidates: jest.fn(),
  listOrderReceiptRecords: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { PUT } from '@/app/api/invoice/route';
import { applyInvoiceRematch } from '@/lib/invoice-service';

const mockApplyInvoiceRematch = applyInvoiceRematch as jest.Mock;

function request(body: unknown): Request {
  return new Request('https://example.test/api/invoice', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('invoice rematch administrator route', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    currentRole = UserRole.ADMIN;
    mockApplyInvoiceRematch.mockResolvedValue({ message: '冲突处理完成' });
  });

  it.each([UserRole.USER, UserRole.SALES])('rejects %s rematch apply', async (role) => {
    currentRole = role;

    const response = await PUT(request({ action: 'rematch-apply' }) as never);

    expect(response.status).toBe(403);
    expect(mockApplyInvoiceRematch).not.toHaveBeenCalled();
  });

  it('forwards explicit system-pool resolutions for an administrator', async () => {
    const resolutions = [{
      groupId: 'exact:ab-12',
      keepOrderId: 'formal-order',
      mode: 'keep',
      orderIds: ['formal-order', 'duplicate-order'],
    }];
    const poolResolutions = [{
      sourceOrderId: 'pool-order',
      targetInvoiceId: 'invoice-1',
    }];

    const response = await PUT(request({
      action: 'rematch-apply',
      resolutions,
      poolResolutions,
    }) as never);

    expect(response.status).toBe(200);
    expect(mockApplyInvoiceRematch).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1', role: UserRole.ADMIN }),
      resolutions,
      poolResolutions,
    );
  });
});
