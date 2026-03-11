import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';
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
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockConsolidateGroupedOrders = consolidateGroupedOrders as jest.Mock;
const mockFindOrderIdByNoOrAliasWithExecutor = findOrderIdByNoOrAliasWithExecutor as jest.Mock;
const mockSyncOrderAliases = syncOrderAliases as jest.Mock;

describe('invoice-write', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockConsolidateGroupedOrders.mockResolvedValue({
      mergedGroups: 0,
      mergedOrders: 0,
      createdGroups: 0,
      syncedAliases: 0,
    });
    mockSyncOrderAliases.mockResolvedValue(1);
    mockUpdateOrderBalance.mockResolvedValue(undefined);
  });

  it('rejects invalid rows before opening a transaction', async () => {
    const result = await saveInvoiceWithOrders({
      invNo: 'INV-001',
      createdBy: 'sales-1',
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
      orders: [
        { orderNo: 'IB-01', amount: 100, customerMark: 'IB' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      message: '账单已保存',
    }));
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
});
