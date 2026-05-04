import { ReceiptEditRequestStatus, ReceiptStatus, UserRole } from '@prisma/client';
import type { ReceiptEditRequestRow, ReceiptEditablePatch } from '@/lib/store';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import type { CurrentUser } from '@/lib/request-auth';
import {
  listReceiptEditRequests,
  requestReceiptEdit,
  reviewReceiptEdit,
} from '@/lib/receipt-edit-request-service';

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

describe('receipt-edit-request-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => Promise<unknown>) => callback(mockTx));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
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
      action: 'RECEIPT_EDIT_REQUEST_CREATE',
      actorId: 'sales-1',
      targetId: 'req-1',
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
  });

  it('rejects a pending request without mutating the receipt', async () => {
    mockDb.receiptEditRequest.findUnique.mockResolvedValueOnce({
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
    mockDb.receiptEditRequest.update.mockResolvedValueOnce({
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

    expect(mockDb.receipt.update).not.toHaveBeenCalled();
    expect(mockDb.receiptHistory.create).not.toHaveBeenCalled();
    expect(mockDb.receiptEditRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-2' },
      data: expect.objectContaining({
        status: ReceiptEditRequestStatus.REJECTED,
        approvedBy: 'admin-1',
        reviewComment: 'insufficient evidence',
        pendingReceiptId: null,
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RECEIPT_EDIT_REQUEST_REJECT',
      actorId: 'admin-1',
      targetId: 'req-2',
    }));
  });

  it('lists receipt edit requests using the store row shape', async () => {
    const requestedAt = new Date('2026-05-04T00:00:00.000Z');
    const reviewedAt = new Date('2026-05-05T08:30:00.000Z');
    const prismaRows = [{
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
    }];
    const expectedRows: ReceiptEditRequestRow[] = [{
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
    }];
    mockDb.receiptEditRequest.findMany.mockResolvedValueOnce(prismaRows);

    await expect(listReceiptEditRequests(adminUser)).resolves.toEqual(expectedRows);
  });
});
