import {
  DeletionStatus,
  DeletionTargetType,
  DetailStatus,
  ReceiptStatus,
  UserRole,
} from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { updateOrderBalance } from '@/lib/matching';
import {
  createDeletionRequest,
  ensureDeletionTargetType,
  listDeletionRequests,
  reviewDeletionRequest,
} from '@/lib/deletion-service';

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  level: number;
  parentId: string | null;
  createdById: string | null;
}> = {}) {
  return {
    id: 'user-1',
    email: 'user-1@example.com',
    name: 'User 1',
    role: UserRole.SALES,
    level: 3,
    parentId: 'admin-1',
    createdById: 'admin-1',
    ...overrides,
  };
}

jest.mock('@/lib/db', () => ({
  db: {
    deletionRequest: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    receipt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    detail: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    swift: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    detailItem: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    receiptHistory: {
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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

jest.mock('@/lib/matching', () => ({
  updateOrderBalance: jest.fn(),
}));

const mockDb = db as unknown as {
  deletionRequest: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  receipt: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    aggregate: jest.Mock;
  };
  detail: {
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  swift: {
    findUnique: jest.Mock;
    delete: jest.Mock;
  };
  detailItem: {
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    count: jest.Mock;
  };
  receiptHistory: {
    create: jest.Mock;
  };
  order: {
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;

describe('deletion-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockUpdateOrderBalance.mockResolvedValue(undefined);
  });

  it('filters deletion requests by requester for USER role', async () => {
    mockDb.deletionRequest.findMany.mockResolvedValueOnce([]);

    await listDeletionRequests(makeUser({ id: 'user-1', role: UserRole.USER, level: 4 }));

    expect(mockDb.deletionRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { requestedBy: 'user-1' },
    }));
  });

  it('rejects invalid deletion target type', () => {
    expect(() => ensureDeletionTargetType('UNKNOWN')).toThrow(expect.objectContaining({
      code: 'INVALID_TARGET_TYPE',
    }));
  });

  it('rejects duplicate deletion requests with structured error code', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: DeletionStatus.PENDING,
    });

    await expect(createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'RECEIPT',
      targetId: 'receipt-1',
    })).rejects.toMatchObject({
      code: 'DELETION_REQUEST_EXISTS',
      status: 400,
    });
  });

  it('blocks receipt deletion request when status is RECEIVED', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-1',
      status: ReceiptStatus.RECEIVED,
    });

    await expect(createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'RECEIPT',
      targetId: 'receipt-1',
    })).rejects.toMatchObject({
      code: 'DELETION_NOT_ALLOWED',
      detail: { status: ReceiptStatus.RECEIVED },
    });
  });

  it('blocks detail deletion request when status is Bank_Transfer', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-bank',
      createdBy: 'sales-1',
      status: DetailStatus.Bank_Transfer,
    });

    await expect(createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'DETAIL',
      targetId: 'detail-bank',
    })).rejects.toMatchObject({
      code: 'DELETION_NOT_ALLOWED',
      detail: { status: DetailStatus.Bank_Transfer },
    });
  });

  it('rejects detail deletion request when ownership check fails', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-1',
      createdBy: 'other-sales',
      status: DetailStatus.Waiting_SWIFT,
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(false);

    await expect(createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'DETAIL',
      targetId: 'detail-1',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('rejects swift deletion request when target does not exist', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.swift.findUnique.mockResolvedValueOnce(null);

    await expect(createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'SWIFT',
      targetId: 'swift-missing',
    })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
    });
  });

  it('creates a swift deletion request and records audit event', async () => {
    mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null);
    mockDb.swift.findUnique.mockResolvedValueOnce({
      id: 'swift-1',
      createdBy: 'sales-1',
    });
    mockDb.deletionRequest.create.mockResolvedValueOnce({
      id: 'req-2',
      targetType: DeletionTargetType.SWIFT,
      targetId: 'swift-1',
    });

    const result = await createDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      targetType: 'SWIFT',
      targetId: 'swift-1',
      reason: 'bad upload',
    });

    expect(result.id).toBe('req-2');
    expect(mockDb.deletionRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetType: DeletionTargetType.SWIFT,
        targetId: 'swift-1',
        requestedBy: 'sales-1',
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETION_REQUEST_CREATE',
      actorId: 'sales-1',
      targetType: DeletionTargetType.SWIFT,
      targetId: 'swift-1',
    }));
  });

  it('rejects deletion review for non-admin users', async () => {
    await expect(reviewDeletionRequest({
      currentUser: makeUser({ id: 'sales-1', role: UserRole.SALES }),
      action: 'reject',
      requestId: 'req-3',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('requires request id when reviewing deletion request', async () => {
    await expect(reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: '',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
  });

  it('returns structured error when request record is missing', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce(null);

    await expect(reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: 'req-missing',
    })).rejects.toMatchObject({
      code: 'DELETION_REQUEST_NOT_FOUND',
      status: 400,
    });
  });

  it('returns structured error when request is already processed', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce({
      id: 'req-done',
      status: DeletionStatus.APPROVED,
      targetType: DeletionTargetType.RECEIPT,
      targetId: 'receipt-done',
    });

    await expect(reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: 'req-done',
    })).rejects.toMatchObject({
      code: 'DELETION_REQUEST_ALREADY_PROCESSED',
      status: 400,
    });
  });

  it('rejects a pending deletion request and records audit event', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce({
      id: 'req-4',
      status: DeletionStatus.PENDING,
      targetType: DeletionTargetType.RECEIPT,
      targetId: 'receipt-4',
    });
    mockDb.deletionRequest.update.mockResolvedValueOnce({});

    const result = await reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'reject',
      requestId: 'req-4',
    });

    expect(result).toEqual({ message: '申请已拒绝' });
    expect(mockDb.deletionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-4' },
      data: expect.objectContaining({ status: DeletionStatus.REJECTED, approvedBy: 'admin-1' }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETION_REQUEST_REJECT',
      actorId: 'admin-1',
      targetType: DeletionTargetType.RECEIPT,
      targetId: 'receipt-4',
    }));
  });

  it('approves swift deletion in one transaction and rolls linked statuses back', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce({
      id: 'req-5',
      status: DeletionStatus.PENDING,
      targetType: DeletionTargetType.SWIFT,
      targetId: 'swift-5',
    });

    const tx = {
      deletionRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-5',
          status: DeletionStatus.PENDING,
          targetType: DeletionTargetType.SWIFT,
          targetId: 'swift-5',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      swift: {
        findUnique: jest.fn().mockResolvedValue({ id: 'swift-5', detailId: 'detail-5' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      detail: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          id: 'detail-5',
          status: DetailStatus.Bank_Transfer,
          items: [{ receiptId: 'receipt-5' }],
        }),
      },
      receipt: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockDb.$transaction.mockImplementationOnce(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: 'req-5',
    });

    expect(result).toEqual({ message: '删除成功，状态已回退' });
    expect(tx.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-5' },
      data: { status: DetailStatus.Waiting_SWIFT },
    });
    expect(tx.receipt.update).toHaveBeenCalledWith({
      where: { id: 'receipt-5' },
      data: { status: ReceiptStatus.Waiting_SWIFT },
    });
    expect(tx.swift.delete).toHaveBeenCalledWith({ where: { id: 'swift-5' } });
    expect(tx.deletionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-5' },
      data: expect.objectContaining({ status: DeletionStatus.APPROVED, approvedBy: 'admin-1' }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETION_REQUEST_APPROVE',
      actorId: 'admin-1',
      targetType: DeletionTargetType.SWIFT,
      targetId: 'swift-5',
    }));
    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
  });

  it('approves receipt deletion and updates affected order balance', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce({
      id: 'req-7',
      status: DeletionStatus.PENDING,
      targetType: DeletionTargetType.RECEIPT,
      targetId: 'receipt-7',
    });

    const tx = {
      deletionRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-7',
          status: DeletionStatus.PENDING,
          targetType: DeletionTargetType.RECEIPT,
          targetId: 'receipt-7',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      receipt: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'receipt-7',
          orderId: 'order-7',
          receiptNo: 'RCPT-7',
          date: '2026-03-11',
          tel: '123',
          usd: 88,
          invNo: 'INV-7',
          orderNo: 'ORD-7',
          payer: 'payer',
          imageUrl: '/upload/test.png',
          imageName: 'test.png',
          status: ReceiptStatus.SR_Received,
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
      detailItem: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ detailId: 'detail-7' }])
          .mockResolvedValueOnce([{ amount: 12 }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      receiptHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      detail: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockDb.$transaction.mockImplementationOnce(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const result = await reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: 'req-7',
    });

    expect(result).toEqual({ message: '删除成功，状态已回退' });
    expect(tx.receiptHistory.create).toHaveBeenCalled();
    expect(tx.detailItem.deleteMany).toHaveBeenCalledWith({ where: { receiptId: 'receipt-7' } });
    expect(tx.receipt.delete).toHaveBeenCalledWith({ where: { id: 'receipt-7' } });
    expect(tx.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-7' },
      data: { totalAmount: 12 },
    });
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-7');
  });

  it('fails approval when request state changes inside transaction', async () => {
    mockDb.deletionRequest.findUnique.mockResolvedValueOnce({
      id: 'req-6',
      status: DeletionStatus.PENDING,
      targetType: DeletionTargetType.RECEIPT,
      targetId: 'receipt-6',
    });
    mockDb.$transaction.mockImplementationOnce(async (callback: (trx: { deletionRequest: { findUnique: jest.Mock } }) => Promise<unknown>) => callback({
      deletionRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'req-6',
          status: DeletionStatus.APPROVED,
        }),
      },
    }));

    await expect(reviewDeletionRequest({
      currentUser: makeUser({ id: 'admin-1', role: UserRole.ADMIN, level: 1, parentId: null, createdById: null }),
      action: 'approve',
      requestId: 'req-6',
    })).rejects.toMatchObject({
      code: 'DELETION_REQUEST_STATE_CHANGED',
      status: 409,
    });
  });
});
