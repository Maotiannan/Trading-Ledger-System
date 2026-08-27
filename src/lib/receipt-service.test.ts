import { DetailStatus, ReceiptStatus, SwiftStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { createReceiptRecord, markReceiptReceived, updateReceiptRecord } from '@/lib/receipt-service';
import { createOrder, findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { resolveReceiptEditBinding } from '@/lib/receipt-edit-binding';
import { syncPendingReceiptGeneratorDraft } from '@/lib/receipt-generator-draft-service';
import { applyReceiptEditInTransaction } from '@/lib/receipt-edit-apply-service';

jest.mock('@/lib/db', () => ({
  db: {
    uploadedAsset: {
      updateMany: jest.fn(),
    },
    receipt: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    receiptHistory: {
      create: jest.fn(),
    },
    detailItem: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    detail: {
      update: jest.fn(),
    },
    swift: {
      updateMany: jest.fn(),
    },
    order: {
      create: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
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
  createOrder: jest.fn(),
  findMatchingOrder: jest.fn(),
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/customer-matching', () => ({
  resolveCustomer: jest.fn(),
}));

jest.mock('@/lib/receipt-edit-binding', () => ({
  resolveReceiptEditBinding: jest.fn(),
  syncReceiptDetailItemsForBinding: jest.fn(async (tx, params) => tx.detailItem.updateMany({
    where: { receiptId: params.receiptId },
    data: {
      orderNo: params.orderNo,
      mark: params.customerMark,
    },
  })),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/receipt-generator-draft-service', () => ({
  syncPendingReceiptGeneratorDraft: jest.fn(),
}));

jest.mock('@/lib/receipt-edit-apply-service', () => ({
  applyReceiptEditInTransaction: jest.fn(),
}));

jest.mock('@/lib/order-alias-db', () => ({
  syncOrderAliases: jest.fn(),
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
  receipt: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  receiptHistory: { create: jest.Mock };
  detailItem: { updateMany: jest.Mock; findMany: jest.Mock };
  detail: { update: jest.Mock };
  swift: { updateMany: jest.Mock };
  order: { create: jest.Mock; update: jest.Mock };
  invoice: { findFirst: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockCreateOrder = createOrder as jest.Mock;
const mockFindMatchingOrder = findMatchingOrder as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockResolveReceiptEditBinding = resolveReceiptEditBinding as jest.Mock;
const mockSyncPendingReceiptGeneratorDraft = syncPendingReceiptGeneratorDraft as jest.Mock;
const mockApplyReceiptEdit = applyReceiptEditInTransaction as jest.Mock;

describe('receipt-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.receipt.update.mockReset();
    mockSyncPendingReceiptGeneratorDraft.mockReset();
    mockSyncPendingReceiptGeneratorDraft.mockResolvedValue(undefined);
    mockApplyReceiptEdit.mockResolvedValue({
      receipt: { id: 'receipt-1', orderId: 'order-old' },
      touchedOrderIds: [],
      reversedTransferId: null,
    });
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockCanAccessOwnedResourceAsync.mockResolvedValue(true);
    mockGetHierarchyScope.mockResolvedValue({
      selfId: 'admin-1',
      ancestorIds: new Set<string>(),
      descendantIds: new Set<string>(['sales-1']),
      visibleIds: new Set<string>(['admin-1', 'sales-1']),
      ownerVisibleIds: new Set<string>(['admin-1', 'sales-1']),
    });
    mockResolveCustomer.mockResolvedValue({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockResolveReceiptEditBinding.mockImplementation(async (_tx, input) => ({
      orderId: input.orderNo ? 'order-old' : null,
      orderNo: input.orderNo || null,
      invNo: input.invNo || null,
    }));
  });

  it('rejects receipt creation without customer mark', async () => {
    await expect(createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: 'R-1',
        date: null,
        tel: null,
        usd: 100,
        invNo: null,
        orderNo: 'IB-1',
        payer: null,
        customerMark: null,
        customerName: null,
        customerPhone: null,
        customerCity: null,
        customerId: null,
        isDeposit: false,
      },
      mode: 'confirm',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '客户MARK不能为空',
    });
  });

  it('rejects duplicate receipt number within the same account', async () => {
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-existing' });

    await expect(createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: 'R-1',
        date: null,
        tel: null,
        usd: 100,
        invNo: null,
        orderNo: 'IB-1',
        payer: null,
        customerMark: 'IB',
        customerName: null,
        customerPhone: null,
        customerCity: null,
        customerId: null,
        isDeposit: false,
      },
      mode: 'confirm',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('attaches uploaded asset inside the receipt create transaction', async () => {
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockFindMatchingOrder.mockResolvedValueOnce(null);
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-asset',
      imageUrl: '/upload/images/receipts/direct/test.png',
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });
    mockDb.uploadedAsset.updateMany.mockResolvedValueOnce({ count: 1 });

    await createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: 'R-ASSET',
        date: null,
        tel: null,
        usd: 100,
        invNo: null,
        orderNo: 'IB-1',
        payer: null,
        customerMark: 'IB',
        customerName: null,
        customerPhone: null,
        customerCity: null,
        customerId: null,
        isDeposit: false,
      },
      imagePath: '/upload/images/receipts/direct/test.png',
      imageName: 'test.png',
      mode: 'direct-create',
    });

    expect(mockDb.uploadedAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        path: '/upload/images/receipts/direct/test.png',
        status: 'STAGED',
      }),
      data: expect.objectContaining({
        attachedType: 'RECEIPT',
        attachedId: 'receipt-asset',
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('clears OCR invoice number and formats payer for an unmatched non-deposit order', async () => {
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockFindMatchingOrder.mockResolvedValueOnce(null);
    mockCreateOrder.mockResolvedValueOnce('order-unassociated');
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-ab',
      customerMark: 'AB',
      customerName: 'AB',
      customerPayerName: 'Thierno Oumar Barry',
      customerPhone: '+224 664 51 79 52',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-990',
      imageUrl: null,
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });

    await createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: '0000990',
        date: null,
        tel: '+224 664 51 79 52',
        usd: 4000,
        invNo: 'L25MH060992C',
        orderNo: 'AB-13B',
        payer: 'AB',
        customerMark: 'AB',
        customerName: 'AB',
        customerPhone: '+224 664 51 79 52',
        customerCity: 'Conakry',
        customerId: 'customer-ab',
        isDeposit: false,
      },
      mode: 'confirm',
    });

    expect(mockCreateOrder).toHaveBeenCalledWith('AB-13B', 'sales-1', mockDb);
    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invNo: null,
        payer: 'Thierno Oumar Barry "AB"',
        orderNo: 'AB-13B',
        orderId: 'order-unassociated',
      }),
    }));
  });

  it('stores the full matched composite ORDER NO when a single segment matches an existing order', async () => {
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockFindMatchingOrder.mockResolvedValueOnce({
      orderId: 'order-composite',
      orderNo: 'AB-13B/AB-12B',
      amount: 10000,
      orderBalance: 10000,
    });
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-ab',
      customerMark: 'AB',
      customerName: 'AB',
      customerPayerName: 'Thierno Oumar Barry',
      customerPhone: '+224 664 51 79 52',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-composite',
      imageUrl: null,
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });

    await createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: '0000991',
        date: null,
        tel: '+224 664 51 79 52',
        usd: 3200,
        invNo: 'L25MH060992C',
        orderNo: 'AB-13B',
        payer: 'AB',
        customerMark: 'AB',
        customerName: 'AB',
        customerPhone: '+224 664 51 79 52',
        customerCity: 'Conakry',
        customerId: 'customer-ab',
        isDeposit: false,
      },
      mode: 'confirm',
    });

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(mockDb.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invNo: 'L25MH060992C',
        orderNo: 'AB-13B/AB-12B',
        orderId: 'order-composite',
      }),
    }));
  });

  it('aborts receipt create before post-transaction work when attach fails', async () => {
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockFindMatchingOrder.mockResolvedValueOnce(null);
    mockDb.receipt.create.mockResolvedValueOnce({
      id: 'receipt-asset-fail',
      imageUrl: '/upload/images/receipts/direct/test.png',
      creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
    });
    mockDb.uploadedAsset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createReceiptRecord({
      currentUser: makeUser(),
      payload: {
        receiptNo: 'R-ASSET-FAIL',
        date: null,
        tel: null,
        usd: 100,
        invNo: null,
        orderNo: 'IB-1',
        payer: null,
        customerMark: 'IB',
        customerName: null,
        customerPhone: null,
        customerCity: null,
        customerId: null,
        isDeposit: false,
      },
      imagePath: '/upload/images/receipts/direct/test.png',
      imageName: 'test.png',
      mode: 'confirm',
    })).rejects.toThrow('Expected to attach exactly one staged uploaded asset');

    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('updates receipt history and balances when modifying a receipt', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-1',
      status: ReceiptStatus.SR_Received,
      receiptNo: 'R-OLD',
      date: null,
      tel: null,
      usd: 100,
      invNo: null,
      orderNo: 'IB-1',
      payer: null,
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-1' });

    const result = await updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-1',
      payload: {
        receiptNo: 'R-NEW',
        date: null,
        orderNo: 'IB-1',
        tel: null,
        invNo: null,
        payer: null,
        customerMark: 'IB',
      },
    });

    expect(mockApplyReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({
      tx: mockDb,
      receiptId: 'receipt-1',
      source: 'DIRECT_ADMIN_EDIT',
    }));

    expect(mockApplyReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({
      currentUser: expect.objectContaining({ role: UserRole.ADMIN }),
      ownerIds: ['admin-1', 'sales-1'],
      patch: {
        receiptNo: 'R-NEW',
        date: null,
        orderNo: 'IB-1',
        tel: null,
        invNo: null,
        customerMark: 'IB',
        payer: null,
      },
      nextDate: null,
      historyNote: '重新识别前保存',
    }));
    expect(mockFindMatchingOrder).not.toHaveBeenCalled();
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
    expect(result.data.id).toBe('receipt-1');
  });

  it('updates a signing-pending receipt and its generator draft in the same transaction', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-signing',
      createdBy: 'sales-1',
      status: ReceiptStatus.SIGNING_PENDING,
      receiptNo: '0010009',
      date: new Date('2026-08-20T00:00:00.000Z'),
      tel: '111',
      usd: 500,
      invNo: 'INV-OLD',
      orderNo: 'OLD-01',
      payer: 'Old Payer',
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-old',
      customerMark: 'OLD',
      customerName: 'Old Customer',
      customerPhone: '111',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-signing' });
    mockApplyReceiptEdit.mockResolvedValueOnce({
      receipt: { id: 'receipt-signing', orderId: 'order-new' },
      touchedOrderIds: ['order-old', 'order-new'],
      reversedTransferId: null,
    });

    await updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-signing',
      payload: {
        receiptNo: '0010010',
        date: '2026-08-26',
        orderNo: 'PIKIN-20',
        invNo: 'INV-NEW',
        customerMark: 'PIKIN',
        payer: 'Mamadou Dian Diallo "PIKIN"',
        tel: '222',
      },
    });

    expect(mockApplyReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({
      tx: mockDb,
      receiptId: 'receipt-signing',
      nextDate: new Date('2026-08-26T00:00:00.000Z'),
      patch: expect.objectContaining({
        orderNo: 'PIKIN-20',
        invNo: 'INV-NEW',
      }),
    }));
  });

  it('does not complete post-transaction work when pending draft synchronization fails', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-signing',
      createdBy: 'sales-1',
      status: ReceiptStatus.SIGNING_PENDING,
      receiptNo: '0010009',
      date: null,
      tel: '111',
      usd: 500,
      invNo: 'INV-OLD',
      orderNo: 'OLD-01',
      payer: 'Old Payer',
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-old',
      customerMark: 'OLD',
      customerName: 'Old Customer',
      customerPhone: '111',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-signing' });
    mockApplyReceiptEdit.mockRejectedValueOnce(new Error('missing signing session'));

    await expect(updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-signing',
      payload: {
        receiptNo: '0010010',
        date: null,
        orderNo: 'OLD-01',
        invNo: 'INV-OLD',
        customerMark: 'OLD',
        payer: 'Old Payer',
        tel: '111',
      },
    })).rejects.toThrow('missing signing session');

    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
  });

  it('maps duplicate receipt number update errors to a readable conflict', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-1',
      status: ReceiptStatus.SR_Received,
      receiptNo: 'R-OLD',
      date: null,
      tel: null,
      usd: 100,
      invNo: null,
      orderNo: 'IB-1',
      payer: null,
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-1' });
    mockApplyReceiptEdit.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['receiptNo'] },
    });

    await expect(updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-1',
      payload: {
        receiptNo: 'R-EXISTING',
        date: null,
        orderNo: 'IB-1',
        tel: null,
        invNo: null,
        payer: null,
        customerMark: 'IB',
      },
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: '收据号 R-EXISTING 已存在，请换一个编号',
    });
  });

  it('rebinds receipt order and recalculates old and new order balances on direct admin update', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-1',
      createdBy: 'sales-1',
      status: ReceiptStatus.SR_Received,
      receiptNo: 'R-OLD',
      date: null,
      tel: null,
      usd: 100,
      invNo: 'INV-OLD',
      orderNo: 'IB-1',
      payer: null,
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-1' });
    mockApplyReceiptEdit.mockResolvedValueOnce({
      receipt: { id: 'receipt-1', orderId: 'order-new' },
      touchedOrderIds: ['order-old', 'order-new'],
      reversedTransferId: 'transfer-1',
    });

    await updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-1',
      payload: {
        receiptNo: 'R-NEW',
        date: null,
        orderNo: 'PIKIN-20',
        tel: null,
        invNo: 'INV-NEW',
        payer: null,
        customerMark: 'PIKIN',
      },
      expectedBalanceTransferId: 'transfer-1',
    });

    expect(mockApplyReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        orderNo: 'PIKIN-20',
        invNo: 'INV-NEW',
      }),
      expectedBalanceTransferId: 'transfer-1',
    }));
  });

  it('allows direct admin rebinding for a RECEIVED receipt and keeps linked detail item aligned', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-received',
      createdBy: 'sales-1',
      status: ReceiptStatus.RECEIVED,
      receiptNo: 'R-DONE',
      date: null,
      tel: null,
      usd: 2500,
      invNo: 'INV-OLD',
      orderNo: 'OLD-01',
      payer: null,
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-1',
      customerMark: 'OLD',
      customerName: 'Old Customer',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-received' });
    mockApplyReceiptEdit.mockResolvedValueOnce({
      receipt: { id: 'receipt-received', orderId: 'order-new' },
      touchedOrderIds: ['order-old', 'order-new'],
      reversedTransferId: null,
    });

    await updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-received',
      payload: {
        receiptNo: 'R-DONE',
        date: null,
        orderNo: 'NEW-02',
        tel: null,
        invNo: 'INV-NEW',
        payer: null,
        customerMark: 'NEW',
      },
    });

    expect(mockApplyReceiptEdit).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: 'receipt-received',
      patch: expect.objectContaining({
        orderNo: 'NEW-02',
        invNo: 'INV-NEW',
      }),
    }));
  });

  it('rejects direct admin update when the receipt is outside receipt visibility scope', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-foreign',
      createdBy: 'other-sales',
      status: ReceiptStatus.SR_Received,
      receiptNo: 'R-OLD',
      date: null,
      tel: null,
      usd: 100,
      invNo: null,
      orderNo: 'IB-1',
      payer: null,
      imageUrl: null,
      imageName: null,
      isDeposit: false,
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'Ibrahima',
      customerPhone: '+224',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      orderId: 'order-old',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);

    await expect(updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-foreign',
      payload: {
        receiptNo: 'R-NEW',
        date: null,
        orderNo: 'IB-1',
        tel: null,
        invNo: null,
        payer: null,
        customerMark: 'IB',
      },
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    expect(mockDb.receipt.update).not.toHaveBeenCalled();
  });

  it('rejects malformed editable dates before direct admin update', async () => {
    await expect(updateReceiptRecord({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-1',
      payload: {
        receiptNo: 'R-NEW',
        date: '2026-02-31',
        orderNo: 'IB-1',
        tel: null,
        invNo: null,
        payer: null,
        customerMark: 'IB',
      },
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    expect(mockDb.receipt.findUnique).not.toHaveBeenCalled();
    expect(mockDb.receipt.update).not.toHaveBeenCalled();
  });

  it('marks receipt received and advances linked detail/swift when all receipts are received', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-bank',
      createdBy: 'sales-1',
      status: ReceiptStatus.Bank_Transfer,
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(true);
    mockDb.receipt.update.mockResolvedValueOnce({
      id: 'receipt-bank',
      status: ReceiptStatus.RECEIVED,
    });
    mockDb.detailItem.findMany.mockResolvedValueOnce([
      {
        detail: {
          id: 'detail-1',
          items: [
            { receipt: { status: ReceiptStatus.RECEIVED } },
            { receipt: { status: ReceiptStatus.RECEIVED } },
          ],
        },
      },
    ]);

    const result = await markReceiptReceived({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-bank',
    });

    expect(result.data.status).toBe(ReceiptStatus.RECEIVED);
    expect(mockDb.detail.update).toHaveBeenCalledWith({
      where: { id: 'detail-1' },
      data: { status: DetailStatus.RECEIVED },
    });
    expect(mockDb.swift.updateMany).toHaveBeenCalledWith({
      where: { detailId: 'detail-1' },
      data: { status: SwiftStatus.RECEIVED },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalled();
  });

  it('rejects mark-received for signing-pending receipts', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-signing',
      createdBy: 'sales-1',
      status: ReceiptStatus.SIGNING_PENDING,
    });

    await expect(markReceiptReceived({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-signing',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '签名未完成的收据不能进入业务流程',
    });
  });

  it('allows admin to complete a waiting receipt and only updates the receipt when sibling receipts remain unfinished', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-waiting',
      createdBy: 'sales-1',
      status: ReceiptStatus.Waiting_SWIFT,
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(true);
    mockDb.receipt.update.mockResolvedValueOnce({
      id: 'receipt-waiting',
      status: ReceiptStatus.RECEIVED,
    });
    mockDb.detailItem.findMany.mockResolvedValueOnce([
      {
        detail: {
          id: 'detail-1',
          items: [
            { receipt: { status: ReceiptStatus.RECEIVED } },
            { receipt: { status: ReceiptStatus.Waiting_SWIFT } },
          ],
        },
      },
    ]);

    const result = await markReceiptReceived({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-waiting',
    });

    expect(result.data.status).toBe(ReceiptStatus.RECEIVED);
    expect(mockDb.detail.update).not.toHaveBeenCalled();
    expect(mockDb.swift.updateMany).not.toHaveBeenCalled();
  });

  it('rejects mark-received for sales users', async () => {
    await expect(markReceiptReceived({
      currentUser: makeUser({ role: UserRole.SALES }),
      receiptId: 'receipt-1',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects mark-received when the receipt is outside current admin visibility', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({
      id: 'receipt-foreign',
      createdBy: 'other-sales',
      status: ReceiptStatus.SR_Received,
    });
    mockCanAccessOwnedResourceAsync.mockResolvedValueOnce(false);

    await expect(markReceiptReceived({
      currentUser: makeUser({ role: UserRole.ADMIN }),
      receiptId: 'receipt-foreign',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
