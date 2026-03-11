import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { resolveCustomer } from '@/lib/customer-matching';
import { saveInvoiceWithOrders } from '@/lib/invoice-write';
import { updateOrderBalance } from '@/lib/matching';
import {
  addInvoiceOrder,
  createInvoiceRecord,
  deleteInvoiceRecord,
  processInvoiceImportRows,
  transferInvoiceBalance,
  updateInvoiceDates,
} from '@/lib/invoice-service';
import {
  consolidateGroupedOrders,
  findOrderIdByNoOrAlias,
  syncOrderAliases,
} from '@/lib/order-alias-db';
import { getHierarchyScope } from '@/lib/user-hierarchy';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    receipt: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    balanceTransfer: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/invoice-write', () => ({
  saveInvoiceWithOrders: jest.fn(),
}));

jest.mock('@/lib/order-alias-db', () => ({
  consolidateGroupedOrders: jest.fn(),
  findOrderIdByNoOrAlias: jest.fn(),
  syncOrderAliases: jest.fn(),
}));

jest.mock('@/lib/customer-matching', () => ({
  resolveCustomer: jest.fn(),
}));

jest.mock('@/lib/matching', () => ({
  updateOrderBalance: jest.fn(),
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
  customer: {
    findMany: jest.Mock;
  };
  invoice: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  order: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  receipt: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  balanceTransfer: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockSaveInvoiceWithOrders = saveInvoiceWithOrders as jest.Mock;
const mockFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;
const mockSyncOrderAliases = syncOrderAliases as jest.Mock;
const mockConsolidateGroupedOrders = consolidateGroupedOrders as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;

describe('invoice-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetHierarchyScope.mockResolvedValue({
      ownerVisibleIds: new Set(['sales-1']),
    });
    mockSyncOrderAliases.mockResolvedValue(1);
    mockConsolidateGroupedOrders.mockResolvedValue({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });
    mockUpdateOrderBalance.mockResolvedValue(undefined);
  });

  it('creates invoice records through saveInvoiceWithOrders and records audit', async () => {
    mockSaveInvoiceWithOrders.mockResolvedValueOnce({
      ok: true,
      data: { id: 'inv-1' },
      message: '账单已保存',
    });

    const result = await createInvoiceRecord(makeUser(), {
      invNo: 'INV-001',
      orders: [{ orderNo: 'IB-01', amount: 100, customerMark: 'IB' }],
    });

    expect(result.message).toBe('账单已保存');
    expect(mockSaveInvoiceWithOrders).toHaveBeenCalledWith(expect.objectContaining({
      invNo: 'INV-001',
      createdBy: 'sales-1',
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_CREATE',
      targetType: 'INVOICE',
      metadata: expect.objectContaining({
        invNo: 'INV-001',
        orderCount: 1,
      }),
    }));
  });

  it('returns structured errors when invoice creation fails', async () => {
    mockSaveInvoiceWithOrders.mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: '账单号不能为空',
    });

    await expect(createInvoiceRecord(makeUser(), {
      invNo: '',
      orders: [{ orderNo: 'IB-01', amount: 100, customerMark: 'IB' }],
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: '账单号不能为空',
    });
  });

  it('imports invoice rows by auto-inferring customer mark from customer order name', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customer.findMany.mockResolvedValueOnce([
      { id: 'customer-1', mark: 'BIG ALPHA', orderName: 'BIG ALPHA' },
    ]);
    mockFindOrderIdByNoOrAlias
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockSaveInvoiceWithOrders.mockResolvedValueOnce({
      ok: true,
      data: { id: 'inv-1' },
      message: '账单已保存',
    });

    const result = await processInvoiceImportRows([
      {
        rowNo: 2,
        invNo: 'INV-IMPORT-1',
        shipDateRaw: '2026-03-10',
        releaseDateRaw: '',
        orderNo: 'BIG ALPHA-05B',
        amountRaw: '1234',
        customerMark: '',
        customerName: '',
        customerId: '',
      },
    ], makeUser());

    expect(result.success).toBe(true);
    expect(result.importedOrderNos).toEqual(['BIG ALPHA-05B']);
    expect(result.rowResults).toEqual([
      expect.objectContaining({
        orderNo: 'BIG ALPHA-05B',
        customerMark: 'BIG ALPHA',
        customerName: 'BIG ALPHA',
        customerId: 'customer-1',
        status: 'SUCCESS',
      }),
    ]);
    expect(mockSaveInvoiceWithOrders).toHaveBeenCalledWith(expect.objectContaining({
      invNo: 'INV-IMPORT-1',
      orders: [
        expect.objectContaining({
          orderNo: 'BIG ALPHA-05B',
          customerMark: 'BIG ALPHA',
          customerName: 'BIG ALPHA',
          customerId: 'customer-1',
        }),
      ],
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_IMPORT',
    }));
  });

  it('returns issue rows when composite invoice orders map to different customer marks', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customer.findMany.mockResolvedValueOnce([
      { id: 'customer-ib', mark: 'IB', orderName: 'IB' },
      { id: 'customer-ab', mark: 'AB', orderName: 'AB' },
    ]);
    mockFindOrderIdByNoOrAlias
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await processInvoiceImportRows([
      {
        rowNo: 3,
        invNo: 'INV-IMPORT-2',
        shipDateRaw: '',
        releaseDateRaw: '',
        orderNo: 'IB-01/AB-02',
        amountRaw: '500',
        customerMark: '',
        customerName: '',
        customerId: '',
      },
    ], makeUser());

    expect(result.success).toBe(false);
    expect(result.issueRows).toEqual([
      expect.objectContaining({
        rowNo: 3,
        reason: expect.stringContaining('这条非同客户单号'),
      }),
    ]);
    expect(result.rowResults).toEqual([
      expect.objectContaining({
        rowNo: 3,
        status: 'FAILED',
        reason: expect.stringContaining('这条非同客户单号'),
      }),
    ]);
    expect(mockSaveInvoiceWithOrders).not.toHaveBeenCalled();
  });

  it('rejects invoice import when no usable rows remain', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customer.findMany.mockResolvedValueOnce([]);

    const result = await processInvoiceImportRows([
      {
        rowNo: 2,
        invNo: '',
        shipDateRaw: '',
        releaseDateRaw: '',
        orderNo: '',
        amountRaw: '',
        customerMark: '',
        customerName: '',
        customerId: '',
      },
    ], makeUser());

    expect(result.success).toBe(false);
    expect(result.message).toBe('没有可导入的数据行');
    expect(result.importedOrderNos).toEqual([]);
  });

  it('updates invoice dates in transaction and records before/after audit values', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      shipDate: new Date('2026-03-01T00:00:00.000Z'),
      releaseDate: null,
    });
    mockDb.invoice.update.mockResolvedValueOnce({
      id: 'inv-1',
      shipDate: new Date('2026-03-15T00:00:00.000Z'),
      releaseDate: new Date('2026-03-16T00:00:00.000Z'),
    });

    const result = await updateInvoiceDates(makeUser(), {
      invoiceId: 'inv-1',
      shipDate: '2026-03-15',
      releaseDate: '2026-03-16',
    });

    expect(result.message).toBe('账单日期已更新');
    expect(mockDb.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: {
        shipDate: new Date('2026-03-15'),
        releaseDate: new Date('2026-03-16'),
      },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_UPDATE_DATES',
      targetId: 'inv-1',
      metadata: expect.objectContaining({
        before: expect.objectContaining({
          shipDate: '2026-03-01T00:00:00.000Z',
          releaseDate: null,
        }),
        after: expect.objectContaining({
          shipDate: '2026-03-15T00:00:00.000Z',
          releaseDate: '2026-03-16T00:00:00.000Z',
        }),
      }),
    }));
  });

  it('blocks invoice deletion when a visible receipt already exists', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      orders: [{ id: 'order-1' }],
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-1' });

    await expect(deleteInvoiceRecord(makeUser(), 'inv-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 400,
      message: '该账单下有收据，无法删除',
      detail: {
        invoiceId: 'inv-1',
        receiptId: 'receipt-1',
      },
    });
  });

  it('deletes invoice in a transaction and records audit when no receipts remain', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      orders: [{ id: 'order-1' }],
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockDb.invoice.delete.mockResolvedValueOnce({ id: 'inv-1' });

    const result = await deleteInvoiceRecord(makeUser(), 'inv-1');

    expect(result).toEqual({ message: '账单已删除' });
    expect(mockDb.invoice.delete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_DELETE',
      targetId: 'inv-1',
    }));
  });

  it('adds orders by merging into an existing visible order and records audit', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '+224620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('order-existing');
    mockDb.order.findUnique.mockResolvedValueOnce({
      id: 'order-existing',
      orderNo: 'IB-01',
      invoiceId: 'inv-1',
    });
    mockDb.order.update.mockResolvedValueOnce({
      id: 'order-existing',
      invoiceId: 'inv-1',
    });

    const result = await addInvoiceOrder(makeUser(), {
      invoiceId: 'inv-1',
      orderNo: 'IB-01',
      amount: 200,
      customerMark: 'IB',
      customerName: 'IB',
    });

    expect(result.merged).toBe(true);
    expect(mockDb.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-existing' },
      data: expect.objectContaining({
        amount: { increment: 200 },
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ADD',
      targetId: 'order-existing',
      metadata: expect.objectContaining({
        merged: true,
        addedAmount: 200,
      }),
    }));
  });

  it('adds orders as a new visible order when alias lookup misses', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1' });
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '+224620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);
    mockDb.order.create.mockResolvedValueOnce({
      id: 'order-new',
      invoiceId: 'inv-1',
      orderNo: 'IB-02',
      amount: 300,
      orderBalance: 300,
    });

    const result = await addInvoiceOrder(makeUser(), {
      invoiceId: 'inv-1',
      orderNo: 'IB-02',
      amount: 300,
      customerMark: 'IB',
      customerName: 'IB',
      customerId: 'customer-1',
    });

    expect(result).toEqual(expect.objectContaining({
      merged: false,
      data: expect.objectContaining({ id: 'order-new' }),
    }));
    expect(mockDb.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        orderNo: 'IB-02',
        createdBy: 'sales-1',
      }),
    }));
    expect(mockConsolidateGroupedOrders).toHaveBeenCalledWith({ invoiceIds: ['inv-1'] });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_ADD',
      targetId: 'order-new',
      metadata: expect.objectContaining({
        merged: false,
        addedAmount: 300,
        orderNo: 'IB-02',
      }),
    }));
  });

  it('transfers overpaid balance into an Un_Associated target order and records audit', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-from',
      orderNo: 'IB-01',
      amount: 100,
      createdBy: 'sales-1',
    });
    mockDb.receipt.findMany.mockResolvedValueOnce([{ usd: 150 }]);
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);
    mockDb.invoice.findFirst.mockResolvedValueOnce(null);
    mockDb.invoice.create.mockResolvedValueOnce({ id: 'inv-un' });
    mockDb.order.create.mockResolvedValueOnce({ id: 'order-to' });
    mockDb.balanceTransfer.create.mockResolvedValueOnce({ id: 'transfer-1' });
    mockDb.order.update.mockResolvedValueOnce({});
    mockDb.receipt.create.mockResolvedValueOnce({ id: 'receipt-transfer' });

    const result = await transferInvoiceBalance(makeUser(), {
      fromOrderId: 'order-from',
      toOrderNo: 'IB-02',
      transferAmount: 30,
    });

    expect(result.message).toContain('成功转移 $30.00 到订单 IB-02');
    expect(mockDb.balanceTransfer.create).toHaveBeenCalledWith({
      data: {
        fromOrderId: 'order-from',
        toOrderId: 'order-to',
        amount: 30,
        createdBy: 'sales-1',
      },
    });
    expect(mockUpdateOrderBalance).toHaveBeenNthCalledWith(1, 'order-from');
    expect(mockUpdateOrderBalance).toHaveBeenNthCalledWith(2, 'order-to');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_TRANSFER_BALANCE',
      targetId: 'order-from',
      metadata: expect.objectContaining({
        toOrderId: 'order-to',
        transferAmount: 30,
      }),
    }));
  });

  it('rejects balance transfer when source order has no overpaid amount', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-from',
      orderNo: 'IB-01',
      amount: 100,
      createdBy: 'sales-1',
    });
    mockDb.receipt.findMany.mockResolvedValueOnce([{ usd: 80 }]);

    await expect(transferInvoiceBalance(makeUser(), {
      fromOrderId: 'order-from',
      toOrderNo: 'IB-02',
      transferAmount: 10,
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '该订单没有多付余额可转移',
      detail: expect.objectContaining({
        fromOrderId: 'order-from',
        fromBalance: 20,
      }),
    });
  });
});
