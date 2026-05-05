import { ReceiptStatus, UserRole } from '@prisma/client';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import type { ReceiptEditRequestRow, ReceiptEditablePatch } from '@/lib/receipt-edit-types';
import { recordAuditEvent } from '@/lib/audit';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  listReceiptEditRequests,
  requestReceiptEdit,
  reviewReceiptEdit,
} from '@/lib/receipt-edit-request-service';

const ReceiptEditRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

jest.mock('@/lib/db', () => ({
  db: {
    receipt: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    receiptHistory: {
      create: jest.fn(),
    },
    receiptEditRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
const branchManagerUser = makeUser({
  id: 'manager-1',
  email: 'manager@example.com',
  name: 'Manager',
  role: UserRole.ADMIN,
  level: 2,
  parentId: 'admin-1',
  createdById: 'admin-1',
});

const validEditPayload: ReceiptEditablePatch = {
  receiptNo: '0001002',
  date: '2026-05-04',
  invNo: 'INV-2',
  customerMark: 'MAB-2',
  payer: 'BETA',
  tel: '456',
};

const mockDb = db as unknown as {
  receipt: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  receiptHistory: {
    create: jest.Mock;
  };
  receiptEditRequest: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockTx = {
  receipt: {
    update: jest.fn(),
  },
  receiptHistory: {
    create: jest.fn(),
  },
  receiptEditRequest: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

type WhereClause = Record<string, unknown>;

function isWhereClause(value: unknown): value is WhereClause {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameMembers(values: unknown[], expectedValues: string[]): boolean {
  return values.length === expectedValues.length
    && expectedValues.every((value) => values.includes(value));
}

function omitLogicalKeys(node: WhereClause): WhereClause {
  return Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== 'AND' && key !== 'OR' && key !== 'NOT'),
  );
}

function combineBranches(left: WhereClause[][], right: WhereClause[][]): WhereClause[][] {
  return left.flatMap((leftBranch) => right.map((rightBranch) => [...leftBranch, ...rightBranch]));
}

function getWhereBranches(value: unknown): WhereClause[][] {
  if (!isWhereClause(value)) {
    return [[]];
  }

  const ownNode = omitLogicalKeys(value);
  let branches: WhereClause[][] = [Object.keys(ownNode).length > 0 ? [ownNode] : []];

  const andValue = value.AND;
  if (Array.isArray(andValue)) {
    for (const entry of andValue) {
      branches = combineBranches(branches, getWhereBranches(entry));
    }
  }

  const orValue = value.OR;
  if (Array.isArray(orValue) && orValue.length > 0) {
    const orBranches = orValue.flatMap((entry) => getWhereBranches(entry));
    branches = combineBranches(branches, orBranches);
  }

  return branches;
}

function hasWhereNode(
  value: unknown,
  predicate: (node: WhereClause) => boolean,
  options: { includeNot?: boolean } = {},
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasWhereNode(entry, predicate, options));
  }
  if (!isWhereClause(value)) {
    return false;
  }
  if (predicate(value)) {
    return true;
  }
  return Object.entries(value).some(([key, entry]) => {
    if (!options.includeNot && key === 'NOT') {
      return false;
    }
    return hasWhereNode(entry, predicate, options);
  });
}

function hasNegatedWhereNode(value: unknown, predicate: (node: WhereClause) => boolean): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNegatedWhereNode(entry, predicate));
  }
  if (!isWhereClause(value)) {
    return false;
  }

  if ('NOT' in value && hasWhereNode(value.NOT, predicate, { includeNot: true })) {
    return true;
  }

  return Object.entries(value).some(([, entry]) => hasNegatedWhereNode(entry, predicate));
}

function getListWhereClause(): WhereClause {
  expect(mockDb.receiptEditRequest.findMany).toHaveBeenCalledTimes(1);
  const [args] = mockDb.receiptEditRequest.findMany.mock.calls[0] as [{ where?: WhereClause }];
  expect(args?.where).toBeDefined();
  return args.where as WhereClause;
}

function hasRequestedByScope(value: unknown, expectedIds: string[]): boolean {
  return hasWhereNode(value, (node) => {
    const requestedBy = node.requestedBy;
    if (typeof requestedBy === 'string') {
      return expectedIds.length === 1 && requestedBy === expectedIds[0];
    }
    if (!isWhereClause(requestedBy)) {
      return false;
    }
    const inScope = requestedBy.in;
    return Array.isArray(inScope) && sameMembers(inScope, expectedIds);
  });
}

function hasReceiptVisibilityConstraint(value: unknown, expectedOwnerIds: string[]): boolean {
  return hasWhereNode(value, (node) => {
    const receipt = node.receipt;
    if (!isWhereClause(receipt)) {
      return false;
    }
    return hasWhereNode(receipt, (receiptNode) => {
      const directCreatedBy = receiptNode.createdBy;
      const directOwnerId = receiptNode.ownerId;

      if (isWhereClause(directCreatedBy)) {
        const inScope = directCreatedBy.in;
        if (Array.isArray(inScope) && sameMembers(inScope, expectedOwnerIds)) {
          return true;
        }
      }
      if (isWhereClause(directOwnerId)) {
        const inScope = directOwnerId.in;
        if (Array.isArray(inScope) && sameMembers(inScope, expectedOwnerIds)) {
          return true;
        }
      }
      return false;
    });
  });
}

function getStatusValues(value: unknown): string[] {
  const values = new Set<string>();

  hasWhereNode(value, (node) => {
    const status = node.status;
    if (typeof status === 'string') {
      values.add(status);
    } else if (isWhereClause(status)) {
      const inScope = status.in;
      if (Array.isArray(inScope)) {
        for (const entry of inScope) {
          if (typeof entry === 'string') {
            values.add(entry);
          }
        }
      }
    }
    return false;
  });

  return Array.from(values);
}

function branchAllowsPending(branch: WhereClause[]): boolean {
  const statuses = branch.flatMap((node) => getStatusValues(node));
  const hasNegatedPending = branch.some((node) => hasNegatedWhereNode(node, (candidate) => {
    const status = candidate.status;
    if (typeof status === 'string') {
      return status === ReceiptEditRequestStatus.PENDING;
    }
    if (!isWhereClause(status)) {
      return false;
    }
    const inScope = status.in;
    return Array.isArray(inScope) && inScope.includes(ReceiptEditRequestStatus.PENDING);
  }));

  if (hasNegatedPending) {
    return statuses.includes(ReceiptEditRequestStatus.PENDING);
  }
  if (statuses.length === 0) {
    return true;
  }
  return statuses.includes(ReceiptEditRequestStatus.PENDING);
}

function expectEveryBranchToIncludeIntersection(
  where: WhereClause,
  expectedRequesterIds: string[],
  expectedOwnerIds: string[],
): void {
  const branches = getWhereBranches(where);
  expect(branches.length).toBeGreaterThan(0);
  expect(branches.every((branch) => (
    hasRequestedByScope(branch, expectedRequesterIds)
      && hasReceiptVisibilityConstraint(branch, expectedOwnerIds)
  ))).toBe(true);
}

function expectPendingBranchesToIncludeIntersection(
  where: WhereClause,
  expectedRequesterIds: string[],
  expectedOwnerIds: string[],
): void {
  const branches = getWhereBranches(where);
  const pendingBranches = branches.filter(branchAllowsPending);

  expect(pendingBranches.length).toBeGreaterThan(0);
  expect(pendingBranches.every((branch) => (
    hasRequestedByScope(branch, expectedRequesterIds)
      && hasReceiptVisibilityConstraint(branch, expectedOwnerIds)
  ))).toBe(true);
}

describe('receipt-edit-request-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockGetHierarchyScope.mockResolvedValue({
      selfId: adminUser.id,
      ancestorIds: new Set<string>(),
      descendantIds: new Set<string>(['sales-1']),
      visibleIds: new Set<string>(['admin-1', 'sales-1']),
      ownerVisibleIds: new Set<string>(['admin-1', 'sales-1']),
    });
  });

  it('creates a pending receipt edit request for SALES on a visible receipt', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-owner',
      status: ReceiptStatus.SR_Received,
      receiptNo: '0001001',
      date: null,
      invNo: 'INV-1',
      customerMark: 'MAB-1',
      payer: 'ACME',
      tel: '123',
    });
    mockDb.receiptEditRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.receiptEditRequest.create.mockResolvedValueOnce({
      id: 'req-1',
      receiptId: 'receipt-1',
      status: ReceiptEditRequestStatus.PENDING,
      pendingReceiptId: 'receipt-1',
      beforeSnapshot: {
        receiptNo: '0001001',
        date: null,
        invNo: 'INV-1',
        customerMark: 'MAB-1',
        payer: 'ACME',
        tel: '123',
      },
      afterSnapshot: validEditPayload,
    });

    const result = await requestReceiptEdit({
      currentUser: salesUser,
      receiptId: 'receipt-1',
      data: validEditPayload,
    });

    expect(result.message).toMatch(/等待管理员同意/);
    expect(mockCanAccessOwnedResourceAsync).toHaveBeenCalledWith('sales-owner', salesUser);
    expect(mockDb.receiptEditRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptId: 'receipt-1',
        requestedBy: 'sales-1',
        pendingReceiptId: 'receipt-1',
        status: ReceiptEditRequestStatus.PENDING,
        beforeSnapshot: {
          receiptNo: '0001001',
          date: null,
          invNo: 'INV-1',
          customerMark: 'MAB-1',
          payer: 'ACME',
          tel: '123',
        },
        afterSnapshot: validEditPayload,
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: auditActions.RECEIPT_EDIT_REQUEST_CREATE,
      actorId: 'sales-1',
      targetId: 'req-1',
      targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
    }));
  });

  it('rejects a second pending request for the same receipt', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-owner',
      status: ReceiptStatus.SR_Received,
      receiptNo: '0001001',
      date: null,
      invNo: 'INV-1',
      customerMark: 'MAB-1',
      payer: 'ACME',
      tel: '123',
    });
    mockDb.receiptEditRequest.findFirst.mockResolvedValueOnce({
      id: 'req-existing',
      status: ReceiptEditRequestStatus.PENDING,
    });

    await expect(requestReceiptEdit({
      currentUser: salesUser,
      receiptId: 'receipt-1',
      data: validEditPayload,
    })).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_REQUEST_EXISTS',
    });
    expect(mockCanAccessOwnedResourceAsync).toHaveBeenCalledWith('sales-owner', salesUser);
  });

  it('rejects receipt edit request when the receipt is not visible to the requester', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-owner',
      status: ReceiptStatus.SR_Received,
      receiptNo: '0001001',
      date: null,
      invNo: 'INV-1',
      customerMark: 'MAB-1',
      payer: 'ACME',
      tel: '123',
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(false);

    await expect(requestReceiptEdit({
      currentUser: salesUser,
      receiptId: 'receipt-1',
      data: validEditPayload,
    })).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_REQUEST_FORBIDDEN',
    });

    expect(mockCanAccessOwnedResourceAsync).toHaveBeenCalledWith('sales-owner', salesUser);
    expect(mockDb.receiptEditRequest.findFirst).not.toHaveBeenCalled();
    expect(mockDb.receiptEditRequest.create).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('approves a pending request and updates the receipt in one transaction', async () => {
    mockTx.receiptEditRequest.findUnique.mockResolvedValueOnce({
      id: 'req-1',
      receiptId: 'receipt-1',
      status: ReceiptEditRequestStatus.PENDING,
      requestedBy: 'sales-1',
      afterSnapshot: validEditPayload,
      receipt: {
        id: 'receipt-1',
        createdBy: 'sales-owner',
        status: ReceiptStatus.SR_Received,
        receiptNo: '0001001',
        date: null,
        invNo: 'INV-1',
        customerMark: 'MAB-1',
        payer: 'ACME',
        tel: '123',
        usd: 100,
        orderNo: 'ORD-1',
        imageUrl: null,
        imageName: null,
        isDeposit: false,
      },
      requester: salesUser,
    });
    mockTx.receipt.update.mockResolvedValueOnce({
      id: 'receipt-1',
      receiptNo: '0001002',
    });
    mockTx.receiptEditRequest.update.mockResolvedValueOnce({
      id: 'req-1',
      status: ReceiptEditRequestStatus.APPROVED,
      pendingReceiptId: null,
    });

    await reviewReceiptEdit({
      currentUser: adminUser,
      requestId: 'req-1',
      decision: 'approve',
      comment: 'looks good',
    });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.receiptHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        receiptId: 'receipt-1',
        receiptNo: '0001001',
        invNo: 'INV-1',
        payer: 'ACME',
      }),
    }));
    expect(mockTx.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'receipt-1' },
      data: expect.objectContaining({
        receiptNo: '0001002',
        date: new Date('2026-05-04'),
        invNo: 'INV-2',
        customerMark: 'MAB-2',
        payer: 'BETA',
        tel: '456',
      }),
    }));
    expect(mockTx.receiptEditRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-1' },
      data: expect.objectContaining({
        status: ReceiptEditRequestStatus.APPROVED,
        approvedBy: 'admin-1',
        reviewComment: 'looks good',
        pendingReceiptId: null,
      }),
    }));
    expect(mockDb.receipt.update).not.toHaveBeenCalled();
    expect(mockDb.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockDb.receiptEditRequest.findUnique).not.toHaveBeenCalled();
    expect(mockDb.receiptEditRequest.update).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: auditActions.RECEIPT_EDIT_REQUEST_APPROVE,
      actorId: 'admin-1',
      targetId: 'req-1',
      targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
    }));
  });

  it('rejects a pending request without mutating the receipt', async () => {
    mockTx.receiptEditRequest.findUnique.mockResolvedValueOnce({
      id: 'req-2',
      receiptId: 'receipt-1',
      status: ReceiptEditRequestStatus.PENDING,
      requestedBy: 'sales-1',
      afterSnapshot: validEditPayload,
      receipt: {
        id: 'receipt-1',
        createdBy: 'sales-owner',
        status: ReceiptStatus.SR_Received,
        receiptNo: '0001001',
        date: null,
        invNo: 'INV-1',
        customerMark: 'MAB-1',
        payer: 'ACME',
        tel: '123',
      },
      requester: salesUser,
    });
    mockTx.receiptEditRequest.update.mockResolvedValueOnce({
      id: 'req-2',
      status: ReceiptEditRequestStatus.REJECTED,
      pendingReceiptId: null,
    });

    await reviewReceiptEdit({
      currentUser: adminUser,
      requestId: 'req-2',
      decision: 'reject',
      comment: 'insufficient evidence',
    });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.receipt.update).not.toHaveBeenCalled();
    expect(mockDb.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockTx.receipt.update).not.toHaveBeenCalled();
    expect(mockTx.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockTx.receiptEditRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-2' },
    }));
    expect(mockTx.receiptEditRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-2' },
      data: expect.objectContaining({
        status: ReceiptEditRequestStatus.REJECTED,
        approvedBy: 'admin-1',
        reviewComment: 'insufficient evidence',
        pendingReceiptId: null,
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: auditActions.RECEIPT_EDIT_REQUEST_REJECT,
      actorId: 'admin-1',
      targetId: 'req-2',
      targetType: auditTargetTypes.RECEIPT_EDIT_REQUEST,
    }));
    expect(mockDb.receiptEditRequest.findUnique).not.toHaveBeenCalled();
    expect(mockDb.receiptEditRequest.update).not.toHaveBeenCalled();
  });

  it('rejects review when the reviewer cannot access the requester hierarchy', async () => {
    mockTx.receiptEditRequest.findUnique.mockResolvedValueOnce({
      id: 'req-foreign',
      receiptId: 'receipt-9',
      status: ReceiptEditRequestStatus.PENDING,
      requestedBy: 'sales-foreign',
      afterSnapshot: validEditPayload,
      receipt: {
        id: 'receipt-9',
        createdBy: 'sales-foreign',
        status: ReceiptStatus.SR_Received,
        receiptNo: '0001009',
        date: null,
        invNo: 'INV-9',
        customerMark: 'MAB-9',
        payer: 'FOREIGN',
        tel: '999',
      },
      requester: makeUser({
        id: 'sales-foreign',
        email: 'foreign@example.com',
        parentId: 'admin-9',
        createdById: 'admin-9',
      }),
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(false);

    await expect(reviewReceiptEdit({
      currentUser: adminUser,
      requestId: 'req-foreign',
      decision: 'approve',
      comment: 'out of scope',
    })).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_REVIEW_FORBIDDEN',
      status: 403,
    });

    expect(mockCanAccessOwnedResourceAsync).toHaveBeenCalledWith('sales-foreign', adminUser);
    expect(mockTx.receipt.update).not.toHaveBeenCalled();
    expect(mockTx.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockTx.receiptEditRequest.update).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects self-review of a pending request', async () => {
    mockTx.receiptEditRequest.findUnique.mockResolvedValueOnce({
      id: 'req-self',
      receiptId: 'receipt-1',
      status: ReceiptEditRequestStatus.PENDING,
      requestedBy: adminUser.id,
      afterSnapshot: validEditPayload,
      receipt: {
        id: 'receipt-1',
        createdBy: 'sales-owner',
        status: ReceiptStatus.SR_Received,
        receiptNo: '0001001',
        date: null,
        invNo: 'INV-1',
        customerMark: 'MAB-1',
        payer: 'ACME',
        tel: '123',
      },
      requester: adminUser,
    });

    await expect(reviewReceiptEdit({
      currentUser: adminUser,
      requestId: 'req-self',
      decision: 'approve',
      comment: 'self review should be blocked',
    })).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_REVIEW_FORBIDDEN',
      status: 403,
    });

    expect(mockTx.receipt.update).not.toHaveBeenCalled();
    expect(mockTx.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockTx.receiptEditRequest.update).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects review of an already-processed request', async () => {
    mockTx.receiptEditRequest.findUnique.mockResolvedValueOnce({
      id: 'req-approved',
      receiptId: 'receipt-1',
      status: ReceiptEditRequestStatus.APPROVED,
      requestedBy: salesUser.id,
      afterSnapshot: validEditPayload,
      receipt: {
        id: 'receipt-1',
        createdBy: 'sales-owner',
        status: ReceiptStatus.SR_Received,
        receiptNo: '0001001',
        date: null,
        invNo: 'INV-1',
        customerMark: 'MAB-1',
        payer: 'ACME',
        tel: '123',
      },
      requester: salesUser,
    });

    await expect(reviewReceiptEdit({
      currentUser: adminUser,
      requestId: 'req-approved',
      decision: 'reject',
      comment: 'already handled',
    })).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_REQUEST_ALREADY_PROCESSED',
    });

    expect(mockTx.receipt.update).not.toHaveBeenCalled();
    expect(mockTx.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockTx.receiptEditRequest.update).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('lists receipt edit requests using the store row shape', async () => {
    const requestedAt = new Date('2026-05-04T00:00:00.000Z');
    const reviewedAt = new Date('2026-05-05T08:30:00.000Z');
    const prismaRows = [
      {
        id: 'req-1',
        receiptId: 'receipt-1',
        status: ReceiptEditRequestStatus.APPROVED,
        requestedBy: 'sales-1',
        requester: {
          name: 'Sales',
          email: 'sales@example.com',
        },
        approvedBy: 'admin-1',
        approver: {
          name: 'Admin',
          email: 'admin@example.com',
        },
        requestedAt,
        reviewedAt,
        beforeSnapshot: {
          receiptNo: '0001001',
          date: null,
          invNo: 'INV-1',
          customerMark: 'MAB-1',
          payer: 'ACME',
          tel: '123',
        },
        afterSnapshot: {
          ...validEditPayload,
        },
        reviewComment: 'approved',
      },
      {
        id: 'req-2',
        receiptId: 'receipt-2',
        status: ReceiptEditRequestStatus.PENDING,
        requestedBy: 'sales-2',
        requester: {
          name: null,
          email: 'pending@example.com',
        },
        approvedBy: null,
        approver: null,
        requestedAt,
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001003',
          date: '2026-05-01',
          invNo: 'INV-3',
          customerMark: null,
          payer: 'GAMMA',
          tel: null,
        },
        afterSnapshot: {
          receiptNo: '0001004',
          date: '2026-05-02',
          invNo: 'INV-4',
          customerMark: 'MAB-4',
          payer: 'DELTA',
          tel: '789',
        },
        reviewComment: null,
      },
    ];
    const expectedRows: ReceiptEditRequestRow[] = [
      {
        id: 'req-1',
        receiptId: 'receipt-1',
        status: 'APPROVED',
        requestedBy: 'sales-1',
        requestedByName: 'Sales',
        approvedBy: 'admin-1',
        approvedByName: 'Admin',
        requestedAt: requestedAt.toISOString(),
        reviewedAt: reviewedAt.toISOString(),
        beforeSnapshot: {
          receiptNo: '0001001',
          date: null,
          invNo: 'INV-1',
          customerMark: 'MAB-1',
          payer: 'ACME',
          tel: '123',
        },
        afterSnapshot: {
          ...validEditPayload,
        },
        reviewComment: 'approved',
      },
      {
        id: 'req-2',
        receiptId: 'receipt-2',
        status: 'PENDING',
        requestedBy: 'sales-2',
        requestedByName: 'pending@example.com',
        approvedBy: null,
        approvedByName: null,
        requestedAt: requestedAt.toISOString(),
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001003',
          date: '2026-05-01',
          invNo: 'INV-3',
          customerMark: null,
          payer: 'GAMMA',
          tel: null,
        },
        afterSnapshot: {
          receiptNo: '0001004',
          date: '2026-05-02',
          invNo: 'INV-4',
          customerMark: 'MAB-4',
          payer: 'DELTA',
          tel: '789',
        },
        reviewComment: null,
      },
    ];
    mockDb.receiptEditRequest.findMany.mockResolvedValueOnce(prismaRows);

    await expect(listReceiptEditRequests(adminUser)).resolves.toEqual(expectedRows);
  });

  it('lists only own submitted visible requests for SALES', async () => {
    const requestedAt = new Date('2026-05-04T00:00:00.000Z');
    mockGetHierarchyScope.mockResolvedValueOnce({
      selfId: salesUser.id,
      ancestorIds: new Set<string>(['admin-1']),
      descendantIds: new Set<string>(),
      visibleIds: new Set<string>(['sales-1', 'admin-1']),
      ownerVisibleIds: new Set<string>(['sales-1']),
    });
    mockDb.receiptEditRequest.findMany.mockResolvedValueOnce([
      {
        id: 'req-own',
        receiptId: 'receipt-own',
        status: ReceiptEditRequestStatus.PENDING,
        requestedBy: 'sales-1',
        requester: {
          name: 'Sales',
          email: 'sales@example.com',
        },
        approvedBy: null,
        approver: null,
        requestedAt,
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001010',
          date: null,
          invNo: 'INV-10',
          customerMark: 'MAB-10',
          payer: 'ALPHA',
          tel: '111',
        },
        afterSnapshot: validEditPayload,
        reviewComment: null,
      },
    ]);

    await expect(listReceiptEditRequests(salesUser)).resolves.toEqual([
      {
        id: 'req-own',
        receiptId: 'receipt-own',
        status: 'PENDING',
        requestedBy: 'sales-1',
        requestedByName: 'Sales',
        approvedBy: null,
        approvedByName: null,
        requestedAt: requestedAt.toISOString(),
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001010',
          date: null,
          invNo: 'INV-10',
          customerMark: 'MAB-10',
          payer: 'ALPHA',
          tel: '111',
        },
        afterSnapshot: validEditPayload,
        reviewComment: null,
      },
    ]);

    const where = getListWhereClause();

    expect(mockDb.receiptEditRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.any(Object),
    }));
    expectEveryBranchToIncludeIntersection(where, ['sales-1'], ['sales-1']);
  });

  it('lists manager-visible requests with descendant-bounded review scope', async () => {
    const requestedAt = new Date('2026-05-05T01:00:00.000Z');
    mockGetHierarchyScope.mockResolvedValueOnce({
      selfId: branchManagerUser.id,
      ancestorIds: new Set<string>(['admin-1']),
      descendantIds: new Set<string>(['sales-1', 'sales-2']),
      visibleIds: new Set<string>(['manager-1', 'admin-1', 'sales-1', 'sales-2']),
      ownerVisibleIds: new Set<string>(['manager-1', 'sales-1', 'sales-2']),
    });
    mockDb.receiptEditRequest.findMany.mockResolvedValueOnce([
      {
        id: 'req-approvable',
        receiptId: 'receipt-branch',
        status: ReceiptEditRequestStatus.PENDING,
        requestedBy: 'sales-2',
        requester: {
          name: 'Sales 2',
          email: 'sales2@example.com',
        },
        approvedBy: null,
        approver: null,
        requestedAt,
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001011',
          date: '2026-05-01',
          invNo: 'INV-11',
          customerMark: null,
          payer: 'BRANCH',
          tel: null,
        },
        afterSnapshot: {
          receiptNo: '0001012',
          date: '2026-05-02',
          invNo: 'INV-12',
          customerMark: 'MAB-12',
          payer: 'BRANCH-NEW',
          tel: '222',
        },
        reviewComment: null,
      },
    ]);

    await expect(listReceiptEditRequests(branchManagerUser)).resolves.toEqual([
      {
        id: 'req-approvable',
        receiptId: 'receipt-branch',
        status: 'PENDING',
        requestedBy: 'sales-2',
        requestedByName: 'Sales 2',
        approvedBy: null,
        approvedByName: null,
        requestedAt: requestedAt.toISOString(),
        reviewedAt: null,
        beforeSnapshot: {
          receiptNo: '0001011',
          date: '2026-05-01',
          invNo: 'INV-11',
          customerMark: null,
          payer: 'BRANCH',
          tel: null,
        },
        afterSnapshot: {
          receiptNo: '0001012',
          date: '2026-05-02',
          invNo: 'INV-12',
          customerMark: 'MAB-12',
          payer: 'BRANCH-NEW',
          tel: '222',
        },
        reviewComment: null,
      },
    ]);

    const where = getListWhereClause();

    expect(mockDb.receiptEditRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.any(Object),
    }));
    expectPendingBranchesToIncludeIntersection(where, ['sales-1', 'sales-2'], ['manager-1', 'sales-1', 'sales-2']);
  });
});
