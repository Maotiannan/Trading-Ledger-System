import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';
import { migrateSystemPoolOrderForInvoiceRow } from '@/lib/invoice-system-pool-reconciliation';
import { saveInvoiceWithOrders } from '@/lib/invoice-write';
import { updateOrderBalance } from '@/lib/matching';
import {
  consolidateGroupedOrders,
  findOrderIdByNoOrAliasWithExecutor,
  syncOrderAliases,
} from '@/lib/order-alias-db';

jest.mock('@/lib/db', () => ({
  db: {
    invoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/customer-matching', () => ({
  resolveCustomer: jest.fn(),
}));

jest.mock('@/lib/matching', () => ({
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/invoice-system-pool-reconciliation', () => ({
  migrateSystemPoolOrderForInvoiceRow: jest.fn(),
}));

jest.mock('@/lib/order-alias-db', () => ({
  consolidateGroupedOrders: jest.fn(),
  findOrderIdByNoOrAliasWithExecutor: jest.fn(),
  syncOrderAliases: jest.fn(),
}));

const mockDb = db as unknown as {
  invoice: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  order: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  receipt: {
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockResolveCustomer = resolveCustomer as jest.Mock;
const mockMigrateSystemPoolOrder = migrateSystemPoolOrderForInvoiceRow as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockConsolidateGroupedOrders = consolidateGroupedOrders as jest.Mock;
const mockFindOrderIdByNoOrAliasWithExecutor = findOrderIdByNoOrAliasWithExecutor as jest.Mock;
const mockSyncOrderAliases = syncOrderAliases as jest.Mock;

describe('invoice-write', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockConsolidateGroupedOrders.mockResolvedValue({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });
    mockSyncOrderAliases.mockResolvedValue(1);
    mockUpdateOrderBalance.mockResolvedValue(undefined);
    mockMigrateSystemPoolOrder.mockResolvedValue(null);
  });

  it('rejects invalid rows before opening a transaction', async () => {
    const result = await saveInvoiceWithOrders({
      invNo: 'INV-001',
      createdBy: 'sales-1',
      operationSource: 'INVOICE_WRITE',
      orders: [
        { orderNo: '', amount: 0, customerMark: '' },
      ],
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: '每一行订单都必须填写 ORDER、AMOUNT(>0)、MARK',
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('persists invoice writes inside a transaction and reconciles balances after commit', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '+224620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce(null);
    mockDb.invoice.create.mockResolvedValueOnce({ id: 'inv-1', invNo: 'INV-001' });
    mockFindOrderIdByNoOrAliasWithExecutor
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockDb.order.create.mockResolvedValueOnce({ id: 'order-1', orderNo: 'IB-01' });
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-1', orderNo: 'IB-01' });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-1',
      orders: [{ id: 'order-1', orderNo: 'IB-01' }],
    });

    const result = await saveInvoiceWithOrders({
      invNo: 'INV-001',
      createdBy: 'sales-1',
      operationSource: 'INVOICE_WRITE',
      orders: [
        { orderNo: 'IB-01', amount: 100, customerMark: 'IB' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      message: '账单已保存',
    }));
    expect(mockResolveCustomer).toHaveBeenCalledWith({
      customerMark: 'IB',
      customerName: null,
      customerId: null,
      customerOrderNo: 'IB-01',
      ownerIds: undefined,
    });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        invoiceId: 'inv-1',
        orderNo: 'IB-01',
        createdBy: 'sales-1',
      }),
    }));
    expect(mockConsolidateGroupedOrders).toHaveBeenCalledWith({ invoiceIds: ['inv-1'] });
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-1');
  });

  it('updates an existing target-invoice order and appends customer-fix notice', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: null,
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1', invNo: 'INV-001' });
    mockDb.invoice.update.mockResolvedValueOnce(undefined);
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce('order-1');
    mockDb.order.findUnique
      .mockResolvedValueOnce({ id: 'order-1', orderNo: 'IB-01' })
      .mockResolvedValueOnce({ id: 'order-1', orderNo: 'IB-01' });
    mockDb.order.update.mockResolvedValueOnce(undefined);
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-1',
      orders: [{ id: 'order-1', orderNo: 'IB-01' }],
    });

    const result = await saveInvoiceWithOrders({
      invNo: 'INV-001',
      createdBy: 'sales-1',
      operationSource: 'INVOICE_WRITE',
      shipDate: new Date('2026-03-11T00:00:00.000Z'),
      orders: [
        { orderNo: 'IB-01', amount: 80, customerMark: 'IB' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      message: '账单已保存，请修复客户信息',
    }));
    expect(mockDb.invoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        shipDate: new Date('2026-03-11T00:00:00.000Z'),
      }),
    }));
    expect(mockDb.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        amount: { increment: 80 },
        orderBalance: { increment: 80 },
        customerMark: 'IB',
        needsCustomerFix: true,
      }),
    }));
    expect(mockDb.order.create).not.toHaveBeenCalled();
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-1');
  });

  it('passes owner visibility into customer resolution so wrong MARK can fall back by ORDER', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-2',
      customerMark: 'KIGNA TEXTILE',
      customerName: 'GANDO',
      customerPhone: '+224626944105',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce(null);
    mockDb.invoice.create.mockResolvedValueOnce({ id: 'inv-2', invNo: 'INV-002' });
    mockFindOrderIdByNoOrAliasWithExecutor
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockDb.order.create.mockResolvedValueOnce({ id: 'order-2', orderNo: 'GANDO-07' });
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-2', orderNo: 'GANDO-07' });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-2',
      orders: [{ id: 'order-2', orderNo: 'GANDO-07' }],
    });

    const result = await saveInvoiceWithOrders({
      invNo: 'INV-002',
      createdBy: 'admin-1',
      operationSource: 'INVOICE_WRITE',
      ownerIds: ['sales-1', 'admin-1'],
      orders: [
        { orderNo: 'GANDO-07', amount: 200, customerMark: 'KIGNATEX' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(mockResolveCustomer).toHaveBeenCalledWith({
      customerMark: 'KIGNATEX',
      customerName: null,
      customerId: null,
      customerOrderNo: 'GANDO-07',
      ownerIds: ['sales-1', 'admin-1'],
    });
  });

  it('uses the transactional system-pool migration before generic global merging', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-2',
      customerMark: 'UA',
      customerName: 'UA',
      customerPhone: '+224620000001',
      customerCity: 'Conakry',
      needsCustomerFix: false,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce(null);
    mockDb.invoice.create.mockResolvedValueOnce({ id: 'inv-2', invNo: 'INV-002' });
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce(null);
    mockMigrateSystemPoolOrder.mockResolvedValueOnce({
      targetOrderId: 'order-old',
      audit: {
        sourceOrderId: 'order-old',
        sourcePool: 'Un_Associated',
        targetInvoiceId: 'inv-2',
        targetInvNo: 'INV-002',
        targetOrderId: 'order-old',
        movedReceiptCount: 1,
        amountBefore: 0,
        amountAfter: 150,
        balanceBefore: -20,
        balanceAfter: 130,
        operationSource: 'BULK_IMPORT',
      },
    });
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-old', orderNo: 'UA-01' });
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { id: 'deposit-1', orderNo: 'UA-01-EXTRA' },
    ]);
    mockDb.invoice.findUnique.mockResolvedValueOnce({
      id: 'inv-2',
      orders: [{ id: 'order-new', orderNo: 'UA-01' }],
    });

    const result = await saveInvoiceWithOrders({
      invNo: 'INV-002',
      createdBy: 'sales-1',
      operationSource: 'BULK_IMPORT',
      orders: [
        { orderNo: 'UA-01', amount: 150, customerMark: 'UA' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      message: '账单已保存，部分订单已合并: UA-01 (from Un_Associated)',
      poolMigrations: [expect.objectContaining({ sourceOrderId: 'order-old' })],
    }));
    expect(mockMigrateSystemPoolOrder).toHaveBeenCalledWith(mockDb, {
      orderNo: 'UA-01',
      targetInvoice: { id: 'inv-2', invNo: 'INV-002' },
      authoritativeAmount: 150,
      targetOrderId: null,
      customer: expect.objectContaining({ customerId: 'customer-2' }),
      operationSource: 'BULK_IMPORT',
    });
    expect(mockFindOrderIdByNoOrAliasWithExecutor).toHaveBeenCalledTimes(1);
    expect(mockDb.order.create).not.toHaveBeenCalled();
    expect(mockDb.receipt.update).toHaveBeenCalledWith({
      where: { id: 'deposit-1' },
      data: {
        orderId: 'order-old',
        isMerged: true,
      },
    });
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('order-old');
  });

  it('applies the existing target amount rule before merging a system-pool duplicate', async () => {
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'AB',
      customerName: 'Alpha Buyer',
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: false,
    });
    mockDb.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1', invNo: 'INV-001' });
    mockFindOrderIdByNoOrAliasWithExecutor.mockResolvedValueOnce('formal-order');
    mockDb.order.findUnique
      .mockResolvedValueOnce({ id: 'formal-order', orderNo: 'AB-13B' })
      .mockResolvedValueOnce({ id: 'formal-order', orderNo: 'AB-13B' });
    mockDb.order.update.mockResolvedValueOnce(undefined);
    mockMigrateSystemPoolOrder.mockResolvedValueOnce({
      targetOrderId: 'formal-order',
      audit: {
        sourceOrderId: 'deposit-order',
        sourcePool: 'DEPOSIT_POOL',
        targetInvoiceId: 'inv-1',
        targetInvNo: 'INV-001',
        targetOrderId: 'formal-order',
        movedReceiptCount: 1,
        amountBefore: 20000,
        amountAfter: 20000,
        balanceBefore: 12000,
        balanceAfter: 9000,
        operationSource: 'INVOICE_WRITE',
      },
    });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);
    mockDb.invoice.findUnique.mockResolvedValueOnce({ id: 'inv-1', orders: [] });

    const result = await saveInvoiceWithOrders({
      invNo: 'INV-001',
      createdBy: 'sales-1',
      operationSource: 'INVOICE_WRITE',
      orders: [{ orderNo: 'AB-13B', amount: 20000, customerMark: 'AB' }],
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(mockDb.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'formal-order' },
      data: expect.objectContaining({ amount: { increment: 20000 } }),
    }));
    expect(mockMigrateSystemPoolOrder).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      targetOrderId: 'formal-order',
      authoritativeAmount: 20000,
    }));
    expect(mockDb.order.update.mock.invocationCallOrder[0])
      .toBeLessThan(mockMigrateSystemPoolOrder.mock.invocationCallOrder[0]);
  });
});
