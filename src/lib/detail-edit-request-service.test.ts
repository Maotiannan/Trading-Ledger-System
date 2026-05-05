import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import type { CurrentUser } from '@/lib/request-auth';
import type { DetailEditablePatch, DetailEditRequestRow } from '@/lib/detail-edit-types';
import {
  listDetailEditRequests,
  requestDetailEdit,
  reviewDetailEdit,
} from '@/lib/detail-edit-request-service';
import { updateDetailRecord } from '@/lib/detail-service';

jest.mock('@/lib/db', () => ({
  db: {
    detail: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    detailEditRequest: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/ownership', () => ({
  canAccessOwnedResourceAsync: jest.fn(),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/detail-service', () => ({
  updateDetailRecord: jest.fn(),
}));

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'sales-1',
    email: 'sales@example.com',
    name: 'Sales',
    role: UserRole.SALES,
    level: 3,
    parentId: 'admin-1',
    createdById: 'admin-1',
    ...overrides,
  };
}

const salesUser = makeUser();
const adminUser = makeUser({
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
});

const validDetailPatch: DetailEditablePatch = {
  date: '2026-05-05',
  items: [
    { mark: 'MAB-2', orderNo: 'MAB-2-11', amount: 120, receiptId: 'receipt-2' },
  ],
};

const mockDb = db as unknown as {
  detail: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  detailEditRequest: {
    findFirst: jest.Mock;
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockUpdateDetailRecord = updateDetailRecord as jest.Mock;

describe('detail-edit-request-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockGetHierarchyScope.mockResolvedValue({
      ownerVisibleIds: new Set(['sales-owner', 'admin-1']),
      descendantIds: new Set(['sales-1']),
      visibleIds: new Set(['sales-1', 'admin-1']),
    });
  });

  it('creates a pending detail edit request for SALES on a visible Waiting_SWIFT detail', async () => {
    mockDb.detail.findFirst.mockResolvedValue({
      id: 'detail-1',
      status: 'Waiting_SWIFT',
      createdBy: 'sales-owner',
      date: null,
      items: [{ mark: 'MAB-1', orderNo: 'MAB-1-10', amount: 100, receiptId: 'receipt-1' }],
    });
    mockDb.detailEditRequest.findFirst.mockResolvedValue(null);
    mockDb.detailEditRequest.create.mockResolvedValue({ id: 'detail-req-1', status: 'PENDING' });

    const result = await requestDetailEdit({
      currentUser: salesUser,
      detailId: 'detail-1',
      data: validDetailPatch,
    });

    expect(result.message).toMatch(/等待管理员同意/);
    expect(mockDb.detailEditRequest.create).toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('rejects a second pending detail edit request for the same detail', async () => {
    mockDb.detail.findFirst.mockResolvedValue({
      id: 'detail-1',
      status: 'Waiting_SWIFT',
      createdBy: 'sales-owner',
      date: null,
      items: [],
    });
    mockDb.detailEditRequest.findFirst.mockResolvedValue({ id: 'detail-req-existing', status: 'PENDING' });

    await expect(requestDetailEdit({
      currentUser: salesUser,
      detailId: 'detail-1',
      data: validDetailPatch,
    })).rejects.toMatchObject({ code: 'DETAIL_EDIT_REQUEST_EXISTS' });
  });

  it('rejects detail edit requests when detail status is RECEIVED', async () => {
    mockDb.detail.findFirst.mockResolvedValue({
      id: 'detail-2',
      status: 'RECEIVED',
      createdBy: 'sales-owner',
      date: null,
      items: [],
    });

    await expect(requestDetailEdit({
      currentUser: salesUser,
      detailId: 'detail-2',
      data: validDetailPatch,
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/RECEIVED/),
    });
  });

  it('approves a pending detail edit request by replaying updateDetailRecord', async () => {
    mockDb.detail.findFirst.mockResolvedValue({
      id: 'detail-1',
      status: 'Waiting_SWIFT',
    });
    mockDb.detailEditRequest.findUnique.mockResolvedValue({
      id: 'detail-req-1',
      detailId: 'detail-1',
      status: 'PENDING',
      requestedBy: 'sales-1',
      requester: salesUser,
      detail: { id: 'detail-1', createdBy: 'sales-owner', status: 'Waiting_SWIFT' },
      afterSnapshot: validDetailPatch,
    });
    mockDb.detailEditRequest.updateMany.mockResolvedValue({ count: 1 });
    mockUpdateDetailRecord.mockResolvedValue({ data: { id: 'detail-1' }, touchedOrderIds: [] });

    const result = await reviewDetailEdit({
      currentUser: adminUser,
      requestId: 'detail-req-1',
      decision: 'approve',
    });

    expect(mockUpdateDetailRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: adminUser,
      detailId: 'detail-1',
      payload: validDetailPatch,
      skipAudit: true,
    }));
    expect(mockDb.detailEditRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'detail-req-1' }),
      data: expect.objectContaining({ status: 'APPROVED', pendingDetailId: null }),
    }));
    expect(result.message).toMatch(/已通过/);
  });

  it('lists visible detail edit requests for managers', async () => {
    const expectedRows: DetailEditRequestRow[] = [{
      id: 'detail-req-1',
      detailId: 'detail-1',
      status: 'PENDING',
      requestedBy: 'sales-1',
      requestedByName: 'Sales',
      approvedBy: null,
      approvedByName: null,
      requestedAt: '2026-05-05T00:00:00.000Z',
      reviewedAt: null,
      beforeSnapshot: {
        date: null,
        items: [{ mark: 'MAB-1', orderNo: 'MAB-1-10', amount: 100, receiptId: 'receipt-1' }],
      },
      afterSnapshot: validDetailPatch,
      reviewComment: null,
    }];
    mockDb.detailEditRequest.findMany.mockResolvedValue([
      {
        id: 'detail-req-1',
        detailId: 'detail-1',
        status: 'PENDING',
        requestedBy: 'sales-1',
        approvedBy: null,
        requestedAt: new Date('2026-05-05T00:00:00.000Z'),
        reviewedAt: null,
        beforeSnapshot: {
          date: null,
          items: [{ mark: 'MAB-1', orderNo: 'MAB-1-10', amount: 100, receiptId: 'receipt-1' }],
        },
        afterSnapshot: validDetailPatch,
        reviewComment: null,
        requester: { name: 'Sales', email: 'sales@example.com' },
        approver: null,
      },
    ]);

    await expect(listDetailEditRequests(adminUser)).resolves.toEqual(expectedRows);
  });
});
