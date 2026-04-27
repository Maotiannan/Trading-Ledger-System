import { DetailStatus, ReceiptStatus, SwiftStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { canAccessOwnedResourceAsync } from '@/lib/ownership';
import { recordAuditEvent } from '@/lib/audit';
import { createReceiptRecord, markReceiptReceived, updateReceiptRecord } from '@/lib/receipt-service';
import { findMatchingOrder, updateOrderBalance } from '@/lib/matching';
import { resolveCustomer } from '@/lib/customer-matching';

jest.mock('@/lib/db', () => ({
  db: {
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
  receipt: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  receiptHistory: { create: jest.Mock };
  detailItem: { findMany: jest.Mock };
  detail: { update: jest.Mock };
  swift: { updateMany: jest.Mock };
  order: { create: jest.Mock; update: jest.Mock };
  invoice: { findFirst: jest.Mock; create: jest.Mock };
  $transaction: jest.Mock;
};
const mockCanAccessOwnedResourceAsync = canAccessOwnedResourceAsync as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockFindMatchingOrder = findMatchingOrder as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;

describe('receipt-service', () => {
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
    mockFindMatchingOrder.mockResolvedValueOnce({ orderId: 'order-new' });
    mockDb.receipt.update.mockResolvedValueOnce({ id: 'receipt-1', orderId: 'order-new' });

    const result = await updateReceiptRecord({
      currentUser: makeUser(),
      receiptId: 'receipt-1',
      payload: {
        receiptNo: 'R-NEW',
        date: null,
        tel: null,
        usd: 120,
        invNo: null,
        orderNo: 'IB-2',
        payer: null,
        customerMark: 'IB',
        customerName: null,
        customerPhone: null,
        customerCity: null,
        customerId: null,
        isDeposit: false,
      },
    });

    expect(mockDb.receiptHistory.create).toHaveBeenCalled();
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-old');
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-new');
    expect(result.data.id).toBe('receipt-1');
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
