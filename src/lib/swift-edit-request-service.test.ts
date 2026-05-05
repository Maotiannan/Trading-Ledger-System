import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import type { CurrentUser } from '@/lib/request-auth';
import type { SwiftEditablePatch, SwiftEditRequestRow } from '@/lib/swift-edit-types';
import {
  listSwiftEditRequests,
  requestSwiftEdit,
  reviewSwiftEdit,
} from '@/lib/swift-edit-request-service';
import { updateSwiftRecord } from '@/lib/swift-service';

jest.mock('@/lib/db', () => ({
  db: {
    swift: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    swiftEditRequest: {
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

jest.mock('@/lib/swift-service', () => ({
  updateSwiftRecord: jest.fn(),
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

const validSwiftPatch: SwiftEditablePatch = {
  date: '2026-05-05',
  amount: 110,
  senderName: 'New Sender',
  senderAddress: 'Conakry',
  receiverName: 'New Receiver',
  receiverAccount: '123',
};

const mockDb = db as unknown as {
  swift: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
  };
  swiftEditRequest: {
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
const mockUpdateSwiftRecord = updateSwiftRecord as jest.Mock;

describe('swift-edit-request-service', () => {
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

  it('creates a pending swift edit request for SALES on a visible Bank_Transfer swift', async () => {
    mockDb.swift.findFirst.mockResolvedValue({
      id: 'swift-1',
      status: 'Bank_Transfer',
      createdBy: 'sales-owner',
      date: null,
      amount: 100,
      senderName: 'Old Sender',
      senderAddress: null,
      receiverName: 'Old Receiver',
      receiverAccount: null,
      hasError: false,
    });
    mockDb.swiftEditRequest.findFirst.mockResolvedValue(null);
    mockDb.swiftEditRequest.create.mockResolvedValue({ id: 'swift-req-1', status: 'PENDING' });

    const result = await requestSwiftEdit({
      currentUser: salesUser,
      swiftId: 'swift-1',
      data: validSwiftPatch,
    });

    expect(result.message).toMatch(/等待管理员同意/);
    expect(mockDb.swiftEditRequest.create).toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('rejects a second pending swift edit request for the same swift', async () => {
    mockDb.swift.findFirst.mockResolvedValue({
      id: 'swift-1',
      status: 'Bank_Transfer',
      createdBy: 'sales-owner',
      date: null,
      amount: 100,
      senderName: 'Old Sender',
      senderAddress: null,
      receiverName: 'Old Receiver',
      receiverAccount: null,
      hasError: false,
    });
    mockDb.swiftEditRequest.findFirst.mockResolvedValue({ id: 'swift-req-existing', status: 'PENDING' });

    await expect(requestSwiftEdit({
      currentUser: salesUser,
      swiftId: 'swift-1',
      data: validSwiftPatch,
    })).rejects.toMatchObject({ code: 'SWIFT_EDIT_REQUEST_EXISTS' });
  });

  it('rejects swift edit requests when swift status is RECEIVED', async () => {
    mockDb.swift.findFirst.mockResolvedValue({
      id: 'swift-2',
      status: 'RECEIVED',
      createdBy: 'sales-owner',
      date: null,
      amount: 100,
      senderName: 'Old Sender',
      senderAddress: null,
      receiverName: 'Old Receiver',
      receiverAccount: null,
      hasError: false,
    });

    await expect(requestSwiftEdit({
      currentUser: salesUser,
      swiftId: 'swift-2',
      data: validSwiftPatch,
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/RECEIVED/),
    });
  });

  it('approves a pending swift edit request by replaying updateSwiftRecord', async () => {
    mockDb.swift.findFirst.mockResolvedValue({
      id: 'swift-1',
      status: 'Bank_Transfer',
    });
    mockDb.swiftEditRequest.findUnique.mockResolvedValue({
      id: 'swift-req-1',
      swiftId: 'swift-1',
      status: 'PENDING',
      requestedBy: 'sales-1',
      requester: salesUser,
      swift: { id: 'swift-1', createdBy: 'sales-owner', status: 'Bank_Transfer', hasError: false },
      afterSnapshot: validSwiftPatch,
    });
    mockDb.swiftEditRequest.updateMany.mockResolvedValue({ count: 1 });
    mockUpdateSwiftRecord.mockResolvedValue({ data: { id: 'swift-1' }, validation: { valid: true, hasWarning: false, message: null } });

    const result = await reviewSwiftEdit({
      currentUser: adminUser,
      requestId: 'swift-req-1',
      decision: 'approve',
    });

    expect(mockUpdateSwiftRecord).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: adminUser,
      swiftId: 'swift-1',
      payload: validSwiftPatch,
      skipAudit: true,
    }));
    expect(mockDb.swiftEditRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'swift-req-1' }),
      data: expect.objectContaining({ status: 'APPROVED', pendingSwiftId: null }),
    }));
    expect(result.message).toMatch(/已通过/);
  });

  it('lists visible swift edit requests for managers', async () => {
    const expectedRows: SwiftEditRequestRow[] = [{
      id: 'swift-req-1',
      swiftId: 'swift-1',
      status: 'PENDING',
      requestedBy: 'sales-1',
      requestedByName: 'Sales',
      approvedBy: null,
      approvedByName: null,
      requestedAt: '2026-05-05T00:00:00.000Z',
      reviewedAt: null,
      beforeSnapshot: {
        date: null,
        amount: 100,
        senderName: 'Old Sender',
        senderAddress: null,
        receiverName: 'Old Receiver',
        receiverAccount: null,
      },
      afterSnapshot: validSwiftPatch,
      reviewComment: null,
    }];
    mockDb.swiftEditRequest.findMany.mockResolvedValue([
      {
        id: 'swift-req-1',
        swiftId: 'swift-1',
        status: 'PENDING',
        requestedBy: 'sales-1',
        approvedBy: null,
        requestedAt: new Date('2026-05-05T00:00:00.000Z'),
        reviewedAt: null,
        beforeSnapshot: {
          date: null,
          amount: 100,
          senderName: 'Old Sender',
          senderAddress: null,
          receiverName: 'Old Receiver',
          receiverAccount: null,
        },
        afterSnapshot: validSwiftPatch,
        reviewComment: null,
        requester: { name: 'Sales', email: 'sales@example.com' },
        approver: null,
      },
    ]);

    await expect(listSwiftEditRequests(adminUser)).resolves.toEqual(expectedRows);
  });
});
