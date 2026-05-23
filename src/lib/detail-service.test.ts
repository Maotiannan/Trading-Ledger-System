import { DetailStatus, ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { createDetailRecord, updateDetailRecord } from '@/lib/detail-service';
import { findMatchingReceipt, findOrCreateOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import { resolveAccessiblePaymentAgentId } from '@/lib/payment-agent-service';

jest.mock('@/lib/db', () => ({
  db: {
    uploadedAsset: {
      updateMany: jest.fn(),
    },
    receipt: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      update: jest.fn(),
    },
    detail: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    detailItem: {
      deleteMany: jest.fn(),
    },
    detailHistory: {
      create: jest.fn(),
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
  findMatchingReceipt: jest.fn(),
  findOrCreateOrder: jest.fn(),
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/customer-matching', () => ({
  resolveCustomer: jest.fn(),
}));

jest.mock('@/lib/payment-agent-service', () => ({
  resolveAccessiblePaymentAgentId: jest.fn(),
}));

function makeUser(overrides: Partial<{ id: string; role: UserRole }> = {}) {
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
  uploadedAsset: { updateMany: jest.Mock };
  receipt: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  order: { update: jest.Mock };
  detail: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  detailItem: { deleteMany: jest.Mock };
  detailHistory: { create: jest.Mock };
  $transaction: jest.Mock;
};
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockFindMatchingReceipt = findMatchingReceipt as jest.Mock;
const mockFindOrCreateOrder = findOrCreateOrder as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;
const mockResolveAccessiblePaymentAgentId = resolveAccessiblePaymentAgentId as jest.Mock;

describe('detail-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockResolveCustomer.mockResolvedValue({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockResolveAccessiblePaymentAgentId.mockResolvedValue('agent-1');
  });

  it('creates missing receipts/orders during direct detail creation', async () => {
    mockFindMatchingReceipt.mockResolvedValueOnce(null);
    mockFindOrCreateOrder.mockResolvedValueOnce('order-1');
    mockDb.receipt.create.mockResolvedValueOnce({ id: 'receipt-new' });
    mockDb.detail.create.mockResolvedValueOnce({
      id: 'detail-1',
      items: [{ receiptId: 'receipt-new', receipt: { id: 'receipt-new' } }],
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });

    const result = await createDetailRecord({
      currentUser: makeUser(),
      payload: {
        agentId: null,
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-1', amount: 100, receiptId: null, matchedReceiptId: null }],
      },
      mode: 'direct-create',
    });

    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        note: '由付款明细直接创建',
        status: ReceiptStatus.SR_Received,
      }),
    }));
    expect(mockDb.order.update).toHaveBeenCalled();
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-1');
    expect(result.message).toBe('付款明细已直接创建');
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('attaches uploaded asset inside the detail create transaction', async () => {
    mockFindMatchingReceipt.mockResolvedValueOnce(null);
    mockFindOrCreateOrder.mockResolvedValueOnce('order-asset');
    mockDb.receipt.create.mockResolvedValueOnce({ id: 'receipt-asset' });
    mockDb.detail.create.mockResolvedValueOnce({
      id: 'detail-asset',
      imageUrl: '/upload/images/details/ocr/test.png',
      items: [{ receiptId: 'receipt-asset', receipt: { id: 'receipt-asset' } }],
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });
    mockDb.uploadedAsset.updateMany.mockResolvedValueOnce({ count: 1 });

    await createDetailRecord({
      currentUser: makeUser(),
      payload: {
        agentId: 'agent-1',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-1', amount: 100, receiptId: null, matchedReceiptId: null }],
      },
      imagePath: '/upload/images/details/ocr/test.png',
      imageName: 'test.png',
      mode: 'confirm',
    });

    expect(mockDb.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ path: '/upload/images/details/ocr/test.png' }),
      data: expect.objectContaining({
        attachedType: 'DETAIL',
        attachedId: 'detail-asset',
      }),
    }));
  });

  it('rejects explicit receipt selection during direct create when receipt is no longer SR_Received', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-waiting',
      createdBy: 'sales-1',
      imageUrl: null,
      imageName: null,
      status: ReceiptStatus.Waiting_SWIFT,
    });

    await expect(createDetailRecord({
      currentUser: makeUser(),
      payload: {
        agentId: null,
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-1', amount: 100, receiptId: 'receipt-waiting', matchedReceiptId: null }],
      },
      mode: 'direct-create',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '只有SR_Received状态的收据可以加入新建付款明细',
    });

    expect(mockDb.detail.create).not.toHaveBeenCalled();
    expect(mockDb.receipt.updateMany).not.toHaveBeenCalled();
  });

  it('aborts detail create before post-transaction work when attach fails', async () => {
    mockFindMatchingReceipt.mockResolvedValueOnce(null);
    mockFindOrCreateOrder.mockResolvedValueOnce('order-asset');
    mockDb.receipt.create.mockResolvedValueOnce({ id: 'receipt-asset' });
    mockDb.detail.create.mockResolvedValueOnce({
      id: 'detail-asset-fail',
      imageUrl: '/upload/images/details/ocr/test.png',
      items: [{ receiptId: 'receipt-asset', receipt: { id: 'receipt-asset' } }],
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });
    mockDb.uploadedAsset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createDetailRecord({
      currentUser: makeUser(),
      payload: {
        agentId: 'agent-1',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-1', amount: 100, receiptId: null, matchedReceiptId: null }],
      },
      imagePath: '/upload/images/details/ocr/test.png',
      imageName: 'test.png',
      mode: 'confirm',
    })).rejects.toThrow('Expected to attach exactly one staged uploaded asset');

    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects detail update when status is RECEIVED', async () => {
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-received',
      createdBy: 'sales-1',
      status: DetailStatus.RECEIVED,
      agentId: 'agent-existing',
      items: [],
      imageUrl: null,
      imageName: null,
      date: null,
    });

    await expect(updateDetailRecord({
      currentUser: makeUser(),
      detailId: 'detail-received',
      payload: {
        agentId: 'agent-1',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-1', amount: 100, receiptId: null, matchedReceiptId: null }],
      },
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'RECEIVED状态下禁止修改',
    });
  });

  it('allows detail update while status is Bank_Transfer and keeps linked receipts in Bank_Transfer', async () => {
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-bank',
      createdBy: 'sales-1',
      status: DetailStatus.Bank_Transfer,
      agentId: 'agent-existing',
      items: [{ receiptId: 'receipt-old' }],
      imageUrl: null,
      imageName: null,
      date: null,
    });
    mockFindMatchingReceipt.mockResolvedValueOnce('receipt-bank');
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-bank',
      createdBy: 'sales-1',
      imageUrl: null,
      imageName: null,
      status: ReceiptStatus.Bank_Transfer,
    });
    mockDb.detail.update.mockResolvedValueOnce({
      id: 'detail-bank',
      items: [{ receiptId: 'receipt-bank', receipt: { id: 'receipt-bank' } }],
    });

    await updateDetailRecord({
      currentUser: makeUser(),
      detailId: 'detail-bank',
      payload: {
        agentId: 'agent-2',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-2', amount: 120, receiptId: null, matchedReceiptId: null }],
      },
    });

    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['receipt-bank'] } },
      data: { status: ReceiptStatus.Bank_Transfer },
    });
    expect(mockResolveAccessiblePaymentAgentId).toHaveBeenCalledWith(expect.objectContaining({ id: 'sales-1' }), 'agent-2');
  });

  it('writes history and relinks items on detail update', async () => {
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-edit',
      createdBy: 'sales-1',
      status: DetailStatus.Waiting_SWIFT,
      agentId: 'agent-existing',
      items: [{ receiptId: 'receipt-old' }],
      imageUrl: '/old.png',
      imageName: 'old.png',
      date: null,
    });
    mockFindMatchingReceipt.mockResolvedValueOnce('receipt-existing');
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-existing',
      createdBy: 'sales-1',
      imageUrl: null,
      imageName: null,
    });
    mockDb.detail.update.mockResolvedValueOnce({
      id: 'detail-edit',
      items: [{ receiptId: 'receipt-existing', receipt: { id: 'receipt-existing' } }],
    });

    const result = await updateDetailRecord({
      currentUser: makeUser(),
      detailId: 'detail-edit',
      payload: {
        agentId: 'agent-1',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-2', amount: 120, receiptId: null, matchedReceiptId: null }],
      },
      imagePath: '/new.png',
      imageName: 'new.png',
    });

    expect(mockDb.detailHistory.create).toHaveBeenCalled();
    expect(mockDb.detailItem.deleteMany).toHaveBeenCalledWith({ where: { detailId: 'detail-edit' } });
    expect(mockDb.receipt.update).toHaveBeenCalledWith({
      where: { id: 'receipt-existing' },
      data: { imageUrl: '/new.png', imageName: 'new.png' },
    });
    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['receipt-existing'] } },
      data: { status: ReceiptStatus.Waiting_SWIFT },
    });
    expect(result.data.id).toBe('detail-edit');
  });

  it('falls back to matching by order and amount when an edit snapshot contains a stale receipt id', async () => {
    mockDb.detail.findUnique.mockResolvedValueOnce({
      id: 'detail-edit-stale',
      createdBy: 'sales-1',
      status: DetailStatus.Waiting_SWIFT,
      agentId: 'agent-existing',
      items: [{ receiptId: 'receipt-old' }],
      imageUrl: null,
      imageName: null,
      date: null,
    });
    mockDb.receipt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'receipt-rematched',
        createdBy: 'sales-1',
        imageUrl: null,
        imageName: null,
        status: ReceiptStatus.SR_Received,
      });
    mockFindMatchingReceipt.mockResolvedValueOnce('receipt-rematched');
    mockDb.detail.update.mockResolvedValueOnce({
      id: 'detail-edit-stale',
      items: [{ receiptId: 'receipt-rematched', receipt: { id: 'receipt-rematched' } }],
    });

    await updateDetailRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      detailId: 'detail-edit-stale',
      payload: {
        agentId: 'agent-1',
        date: null,
        items: [{ mark: 'IB', orderNo: 'IB-2', amount: 120, receiptId: 'receipt-stale', matchedReceiptId: null }],
      },
    });

    expect(mockFindMatchingReceipt).toHaveBeenCalledWith('IB-2', 120, expect.objectContaining({
      requireAmountTolerance: false,
    }));
    expect(mockDb.detail.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: {
          create: [expect.objectContaining({ receiptId: 'receipt-rematched' })],
        },
      }),
    }));
  });
});
