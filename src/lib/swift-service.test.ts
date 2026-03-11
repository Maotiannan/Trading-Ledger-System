import { DetailStatus, ReceiptStatus, SwiftStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { getNumericSystemSetting } from '@/lib/system-settings';
import { createSwiftRecord, deleteSwiftRecord } from '@/lib/swift-service';

jest.mock('@/lib/db', () => ({
  db: {
    detail: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    swift: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    receipt: {
      updateMany: jest.fn(),
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

jest.mock('@/lib/system-settings', () => ({
  getNumericSystemSetting: jest.fn(),
}));

function makeUser(overrides: Partial<{
  id: string;
  role: UserRole;
}> = {}) {
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

const mockDb = db as unknown as {
  detail: { findUnique: jest.Mock; update: jest.Mock };
  swift: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
  receipt: { updateMany: jest.Mock };
  $transaction: jest.Mock;
};
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetNumericSystemSetting = getNumericSystemSetting as jest.Mock;

describe('swift-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockGetNumericSystemSetting
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(50);
  });

  it('uses configured thresholds when creating swift records', async () => {
    mockGetNumericSystemSetting.mockReset();
    mockGetNumericSystemSetting
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-1',
      createdBy: 'sales-1',
      totalAmount: 100,
      items: [{ receiptId: 'receipt-1' }],
    });
    mockDb.swift.findUnique.mockResolvedValueOnce(null);
    mockDb.swift.create.mockResolvedValueOnce({
      id: 'swift-1',
      detailId: 'detail-1',
      status: SwiftStatus.ERROR,
      hasError: true,
    });

    const result = await createSwiftRecord({
      currentUser: makeUser(),
      detailId: 'detail-1',
      payload: {
        amount: 103,
        date: null,
        senderName: 'sender',
        senderAddress: null,
        receiverName: 'receiver',
        receiverAccount: null,
      },
      mode: 'direct-create',
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.message).toMatch(/±2/);
    expect(mockDb.detail.update).not.toHaveBeenCalled();
    expect(mockDb.receipt.updateMany).not.toHaveBeenCalled();
  });

  it('advances detail and receipt statuses when swift is valid', async () => {
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-2',
      createdBy: 'sales-1',
      totalAmount: 100,
      items: [{ receiptId: 'receipt-2' }, { receiptId: null }],
    });
    mockDb.swift.findUnique.mockResolvedValueOnce(null);
    mockDb.swift.create.mockResolvedValueOnce({
      id: 'swift-2',
      detailId: 'detail-2',
      status: SwiftStatus.Bank_Transfer,
      hasError: true,
    });

    const result = await createSwiftRecord({
      currentUser: makeUser(),
      detailId: 'detail-2',
      payload: {
        amount: 106,
        date: null,
        senderName: 'sender',
        senderAddress: null,
        receiverName: 'receiver',
        receiverAccount: null,
      },
      mode: 'confirm',
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.hasWarning).toBe(true);
    expect(mockDb.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-2' },
      data: { status: DetailStatus.Bank_Transfer },
    });
    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['receipt-2'] } },
      data: { status: ReceiptStatus.Bank_Transfer },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('allows creator to directly delete error swift records', async () => {
    mockDb.swift.findUnique.mockResolvedValueOnce({
      id: 'swift-error',
      detailId: 'detail-3',
      hasError: true,
      createdBy: 'sales-1',
    });

    const result = await deleteSwiftRecord({
      currentUser: makeUser(),
      swiftId: 'swift-error',
    });

    expect(result.message).toBe('错误SWIFT记录已删除');
    expect(mockDb.swift.delete).toHaveBeenCalledWith({ where: { id: 'swift-error' } });
    expect(mockDb.detail.update).not.toHaveBeenCalled();
  });

  it('rolls statuses back when deleting a normal swift record', async () => {
    mockDb.swift.findUnique.mockResolvedValueOnce({
      id: 'swift-ok',
      detailId: 'detail-4',
      hasError: false,
      createdBy: 'sales-1',
    });
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-4',
      items: [{ receiptId: 'receipt-4a' }, { receiptId: 'receipt-4b' }],
    });

    const result = await deleteSwiftRecord({
      currentUser: makeUser({ role: UserRole.ADMIN, id: 'admin-1' }),
      swiftId: 'swift-ok',
    });

    expect(result.message).toBe('SWIFT已删除，状态已回退');
    expect(mockDb.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-4' },
      data: { status: DetailStatus.Waiting_SWIFT },
    });
    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['receipt-4a', 'receipt-4b'] } },
      data: { status: ReceiptStatus.Waiting_SWIFT },
    });
  });
});
