import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { resolveCustomer } from '@/lib/customer-matching';
import { saveInvoiceWithOrders } from '@/lib/invoice-write';
import { updateOrderBalance } from '@/lib/matching';
import {
  addInvoiceOrder,
  assignInvoiceToBranchAdmin,
  applyInvoiceRematch,
  createInvoiceRecord,
  deleteInvoiceOrder,
  deleteInvoiceRecord,
  processInvoiceImportRows,
  previewInvoiceRematch,
  rematchInvoices,
  transferInvoiceBalance,
  updateInvoiceOrder,
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
    customerOrderName: {
      findMany: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    receipt: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
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
  level: number;
  parentId: string | null;
  createdById: string | null;
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
  customerOrderName: {
    findMany: jest.Mock;
  };
  invoice: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
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
    updateMany: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  receipt: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  user: {
    findFirst: jest.Mock;
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
    jest.resetAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetHierarchyScope.mockResolvedValue({
      selfId: 'sales-1',
      ancestorIds: new Set(['admin-1']),
      descendantIds: new Set(),
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
      ownerIds: ['sales-1'],
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

  it('reassigns an invoice and all child orders to a descendant admin in one transaction', async () => {
    mockGetHierarchyScope.mockResolvedValueOnce({
      selfId: 'admin-root',
      ancestorIds: new Set(),
      descendantIds: new Set(['admin-branch']),
      ownerVisibleIds: new Set(['admin-root', 'admin-branch']),
      visibleIds: new Set(['admin-root', 'admin-branch']),
    });
    mockDb.user.findFirst.mockResolvedValueOnce({
      id: 'admin-branch',
      role: UserRole.ADMIN,
      level: 2,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      createdBy: 'admin-root',
      orders: [{ id: 'order-1' }, { id: 'order-2' }],
    });
    mockDb.invoice.update.mockResolvedValueOnce({
      id: 'inv-1',
      createdBy: 'admin-branch',
    });
    mockDb.order.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await assignInvoiceToBranchAdmin(makeUser({
      id: 'admin-root',
      role: UserRole.ADMIN,
      level: 1,
      parentId: null,
      createdById: null,
    }), {
      invoiceId: 'inv-1',
      targetAdminId: 'admin-branch',
    });

    expect(result.message).toBe('账单归属已分配');
    expect(mockDb.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { createdBy: 'admin-branch' },
    });
    expect(mockDb.order.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: 'inv-1' },
      data: { createdBy: 'admin-branch' },
    });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_ASSIGN_BRANCH_ADMIN',
      targetId: 'inv-1',
      metadata: expect.objectContaining({
        previousOwnerId: 'admin-root',
        nextOwnerId: 'admin-branch',
        orderCount: 2,
      }),
    }));
  });

  it('rejects invoice reassignment when the target admin is not in the current admin branch', async () => {
    mockGetHierarchyScope.mockResolvedValueOnce({
      selfId: 'admin-root',
      ancestorIds: new Set(),
      descendantIds: new Set(['admin-branch-a']),
      ownerVisibleIds: new Set(['admin-root', 'admin-branch-a']),
      visibleIds: new Set(['admin-root', 'admin-branch-a']),
    });
    mockDb.user.findFirst.mockResolvedValueOnce(null);

    await expect(assignInvoiceToBranchAdmin(makeUser({
      id: 'admin-root',
      role: UserRole.ADMIN,
      level: 1,
      parentId: null,
      createdById: null,
    }), {
      invoiceId: 'inv-1',
      targetAdminId: 'admin-branch-b',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
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
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'BIG ALPHA',
        normalizedOrderName: 'bigalpha',
        customer: { id: 'customer-1', mark: 'BIG ALPHA', orderName: 'BIG ALPHA' },
      },
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

  it('imports invoice rows by matching ORDER_NAME aliases while ignoring spaces', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'SUPER DT 2',
        normalizedOrderName: 'superdt2',
        customer: { id: 'customer-sdt2', mark: 'SDT 2', orderName: 'SUPER DT 2' },
      },
    ]);
    mockFindOrderIdByNoOrAlias
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockSaveInvoiceWithOrders.mockResolvedValueOnce({
      ok: true,
      data: { id: 'inv-sdt2' },
      message: '账单已保存',
    });

    const result = await processInvoiceImportRows([
      {
        rowNo: 4,
        invNo: 'INV-SDT2-1',
        shipDateRaw: '',
        releaseDateRaw: '',
        orderNo: 'SUPERDT2-09',
        amountRaw: '800',
        customerMark: '',
        customerName: '',
        customerId: '',
      },
    ], makeUser());

    expect(result.success).toBe(true);
    expect(result.rowResults).toEqual([
      expect.objectContaining({
        orderNo: 'SUPERDT2-09',
        customerMark: 'SDT 2',
        customerName: 'SUPER DT 2',
        customerId: 'customer-sdt2',
        status: 'SUCCESS',
      }),
    ]);
  });

  it('returns issue rows when composite invoice orders map to different customer marks', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      { orderName: 'IB', normalizedOrderName: 'ib', customer: { id: 'customer-ib', mark: 'IB', orderName: 'IB' } },
      { orderName: 'AB', normalizedOrderName: 'ab', customer: { id: 'customer-ab', mark: 'AB', orderName: 'AB' } },
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
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

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

  it('previews rematch conflicts within visible owner scope', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-1',
        orderNo: 'IB-01',
        amount: 100,
        orderBalance: 50,
        createdAt: new Date('2026-03-11T00:00:00.000Z'),
        invoice: { id: 'inv-1', invNo: 'INV-1' },
        _count: { receipts: 0 },
      },
      {
        id: 'order-2',
        orderNo: 'IB-01',
        amount: 120,
        orderBalance: 20,
        createdAt: new Date('2026-03-11T00:01:00.000Z'),
        invoice: { id: 'inv-2', invNo: 'INV-2' },
        _count: { receipts: 1 },
      },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([]);

    const result = await previewInvoiceRematch(makeUser());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      groupType: 'exact',
      groupKey: 'ib-01',
    }));
  });

  it('rematches invoices, returns summary, and records audit', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([]) // allOrders
      .mockResolvedValueOnce([]) // freshOrders
      .mockResolvedValueOnce([]) // allReceipts groupOrders path not used
      .mockResolvedValueOnce([]) // touched orderIds
      .mockResolvedValueOnce([]); // zeroOrders
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findMany.mockResolvedValueOnce([]);
    mockConsolidateGroupedOrders.mockResolvedValueOnce({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });

    const result = await rematchInvoices(makeUser());

    expect(result.message).toContain('重新匹配完成');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_REMATCH',
      metadata: expect.objectContaining({
        mergedCount: 0,
        receiptMatchedCount: 0,
      }),
    }));
  });

  it('rematches a single unresolved order by re-running customer resolution', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([
        {
          id: 'order-1',
          invoiceId: 'inv-1',
          orderNo: 'TEST-1-05',
          amount: 100,
          orderBalance: 100,
          receipts: [],
          invoice: { id: 'inv-1', invNo: 'INV-1' },
        },
      ]) // allOrders
      .mockResolvedValueOnce([
        {
          id: 'order-1',
          orderNo: 'TEST-1-05',
          customerId: null,
          customerMark: 'ASD-DSA',
          customerName: null,
          customerPhone: null,
          customerCity: null,
          needsCustomerFix: true,
        },
      ]) // freshOrders
      .mockResolvedValueOnce([]) // orderIds
      .mockResolvedValueOnce([]); // zeroOrders
    mockDb.receipt.findMany
      .mockResolvedValueOnce([]) // allReceipts
      .mockResolvedValueOnce([]); // receiptRows in grouped sync path not used
    mockDb.invoice.findMany.mockResolvedValueOnce([
      { id: 'inv-1', invNo: 'INV-1', _count: { orders: 1 } },
    ]);
    mockDb.order.update.mockResolvedValueOnce({
      id: 'order-1',
    });
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'cust-1',
      customerMark: 'ASD-DSA',
      customerName: 'TEST-1',
      customerPhone: '620123456',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      matchedBy: 'mark',
      candidateCount: 1,
    });
    mockConsolidateGroupedOrders.mockResolvedValueOnce({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });

    const result = await rematchInvoices(makeUser());

    expect(result.message).toContain('同步客户 1');
    expect(mockResolveCustomer).toHaveBeenCalledWith({
      customerMark: 'ASD-DSA',
      customerName: null,
      customerId: null,
      customerOrderNo: 'TEST-1-05',
      ownerIds: ['sales-1'],
    });
    expect(mockDb.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        customerId: 'cust-1',
        customerMark: 'ASD-DSA',
        customerName: 'TEST-1',
        customerPhone: '620123456',
        customerCity: 'Conakry',
        needsCustomerFix: false,
      },
    });
  });

  it('applies manual rematch resolution and records audit summary', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([
        {
          id: 'order-1',
          amount: 100,
          receipts: [],
        },
        {
          id: 'order-2',
          amount: 50,
          receipts: [],
        },
      ])
      .mockResolvedValueOnce([]) // allOrders after manual merge
      .mockResolvedValueOnce([]) // freshOrders
      .mockResolvedValueOnce([]) // orderIds
      .mockResolvedValueOnce([]); // zeroOrders
    mockDb.receipt.updateMany.mockResolvedValueOnce({ count: 0 });
    mockDb.order.delete.mockResolvedValueOnce({ id: 'order-2' });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findMany.mockResolvedValueOnce([]);
    mockConsolidateGroupedOrders.mockResolvedValueOnce({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });

    const result = await applyInvoiceRematch(makeUser(), [
      {
        groupId: 'exact:ib-01',
        keepOrderId: 'order-1',
        mode: 'keep',
        orderIds: ['order-1', 'order-2'],
      },
    ]);

    expect(result.message).toContain('冲突处理完成');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_REMATCH_APPLY',
      metadata: expect.objectContaining({
        manualMerged: 1,
      }),
    }));
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

  it('updates invoice order fields, clears customer ownership when mark is empty, and syncs linked receipts', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'IB-01',
      amount: 100,
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '+224620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.order.update.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'IB-01',
      amount: 120,
      customerId: null,
      customerMark: null,
      customerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    });

    const result = await updateInvoiceOrder(makeUser(), {
      orderId: 'order-1',
      orderNo: 'IB-01',
      amount: 120,
      customerMark: '',
      customerName: '',
      customerPhone: '',
      customerCity: '',
    });

    expect(result.message).toBe('订单已更新');
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(mockDb.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        orderNo: 'IB-01',
        amount: 120,
        customerId: null,
        customerMark: null,
        customerName: null,
        customerPhone: null,
        customerCity: null,
        needsCustomerFix: true,
      }),
    }));
    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      data: {
        orderNo: 'IB-01',
        customerId: null,
        customerMark: null,
        customerName: null,
        customerPhone: null,
        customerCity: null,
        needsCustomerFix: true,
      },
    });
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-1');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_UPDATE',
      targetId: 'order-1',
    }));
  });

  it('moves an order into a different INV group and syncs linked receipt invNo', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '+224620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      matchedBy: 'mark',
      candidateCount: 1,
    });
    mockDb.order.findFirst
      .mockResolvedValueOnce({
        id: 'order-1',
        invoiceId: 'inv-old',
        orderNo: 'IB-01',
        amount: 100,
        customerId: 'customer-1',
        customerMark: 'IB',
        customerName: 'IB',
        customerPhone: '+224620000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
      });
    mockDb.invoice.findFirst
      .mockResolvedValueOnce({ id: 'inv-old', invNo: 'INV-OLD' })
      .mockResolvedValueOnce({ id: 'inv-new', invNo: 'INV-NEW' });
    mockDb.order.findFirst.mockResolvedValueOnce(null);
    mockDb.order.update.mockResolvedValueOnce({
      id: 'order-1',
      invoiceId: 'inv-new',
      orderNo: 'IB-01',
      amount: 100,
    });
    mockDb.order.count.mockResolvedValueOnce(0);

    const result = await updateInvoiceOrder(makeUser(), {
      orderId: 'order-1',
      invNo: 'INV-NEW',
      orderNo: 'IB-01',
      amount: 100,
      customerMark: 'IB',
      customerName: 'IB',
      customerId: 'customer-1',
    });

    expect(result.message).toBe('订单已更新');
    expect(mockDb.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        invoiceId: 'inv-new',
      }),
    }));
    expect(mockDb.receipt.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      data: expect.objectContaining({
        invNo: 'INV-NEW',
      }),
    });
    expect(mockDb.invoice.delete).toHaveBeenCalledWith({ where: { id: 'inv-old' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_UPDATE',
      metadata: expect.objectContaining({
        before: expect.objectContaining({ invNo: 'INV-OLD' }),
        after: expect.objectContaining({ invNo: 'INV-NEW' }),
      }),
    }));
  });

  it('updates invoice orders by retrying customer resolution with ORDER fallback and owner scope', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'GANDO-07',
      amount: 100,
      customerId: null,
      customerMark: 'KIGNATEX',
      customerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    });
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'KIGNA TEXTILE',
      customerName: 'GANDO',
      customerPhone: '+224626944105',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.order.update.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'GANDO-07',
      amount: 100,
    });

    await updateInvoiceOrder(makeUser(), {
      orderId: 'order-1',
      orderNo: 'GANDO-07',
      amount: 100,
      customerMark: 'KIGNATEX',
      customerName: '',
      customerId: '',
    });

    expect(mockResolveCustomer).toHaveBeenCalledWith({
      customerMark: 'KIGNATEX',
      customerName: null,
      customerId: null,
      customerOrderNo: 'GANDO-07',
      ownerIds: ['sales-1'],
    });
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

  it('deletes an order and removes its invoice when it is the last remaining order', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      invoiceId: 'inv-1',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce(null);
    mockDb.order.count.mockResolvedValueOnce(0);
    mockDb.order.delete.mockResolvedValueOnce({ id: 'order-1' });
    mockDb.invoice.delete.mockResolvedValueOnce({ id: 'inv-1' });

    const result = await deleteInvoiceOrder(makeUser(), 'order-1');

    expect(result).toEqual({ message: '订单已删除' });
    expect(mockDb.order.delete).toHaveBeenCalledWith({ where: { id: 'order-1' } });
    expect(mockDb.invoice.delete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_DELETE',
      targetId: 'order-1',
      metadata: { invoiceId: 'inv-1' },
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
    expect(mockResolveCustomer).toHaveBeenCalledWith({
      customerMark: 'IB',
      customerName: 'IB',
      customerId: 'customer-1',
      customerOrderNo: 'IB-02',
      ownerIds: ['sales-1'],
    });
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

  it('blocks deleting an order that still has receipts', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      invoiceId: 'inv-1',
    });
    mockDb.receipt.findFirst.mockResolvedValueOnce({ id: 'receipt-1' });

    await expect(deleteInvoiceOrder(makeUser(), 'order-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: '该订单下有收据，无法删除',
      detail: expect.objectContaining({ orderId: 'order-1' }),
    });
  });

  it('rejects invalid invoice date format', async () => {
    mockDb.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      shipDate: null,
      releaseDate: null,
    });
    mockDb.invoice.update.mockResolvedValueOnce({
      id: 'inv-1',
      shipDate: new Date('2026-03-12T00:00:00Z'),
      releaseDate: null,
    });

    await expect(updateInvoiceDates(makeUser(), {
      invoiceId: 'inv-1',
      shipDate: 'not-a-date',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'SHIP_DATE 格式错误，应为 YYYY-MM-DD',
    });
  });
});
