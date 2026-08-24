import {
  applySystemPoolRepairs,
  migrateSystemPoolOrderForInvoiceRow,
  previewSystemPoolRepairs,
} from '@/lib/invoice-system-pool-reconciliation';
import { updateOrderBalance } from '@/lib/matching';
import {
  findOrderIdByNoOrAliasWithExecutor,
  syncOrderAliases,
} from '@/lib/order-alias-db';

jest.mock('@/lib/matching', () => ({
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAliasWithExecutor: jest.fn(),
  syncOrderAliases: jest.fn(),
}));

const mockFindOrder = findOrderIdByNoOrAliasWithExecutor as jest.Mock;
const mockSyncOrderAliases = syncOrderAliases as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;

const customer = {
  customerId: 'customer-ab',
  customerMark: 'AB',
  customerName: 'Alpha Buyer',
  customerPhone: '+224600000000',
  customerCity: 'Conakry',
  needsCustomerFix: false,
};

function makeTx() {
  return {
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    receipt: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('system-pool invoice reconciliation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockSyncOrderAliases.mockResolvedValue(1);
    mockUpdateOrderBalance.mockResolvedValue(undefined);
  });

  it('moves the original DEPOSIT_POOL order into a formal invoice and preserves its receipts', async () => {
    const tx = makeTx();
    mockFindOrder.mockResolvedValueOnce('deposit-order');
    tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'deposit-order',
        orderNo: 'AB-13B',
        amount: 0,
        orderBalance: -4000,
        invoice: { invNo: 'DEPOSIT_POOL' },
      })
      .mockResolvedValueOnce({ orderBalance: 16000 });
    tx.receipt.count.mockResolvedValueOnce(1);
    tx.order.update.mockResolvedValueOnce({ id: 'deposit-order' });

    const result = await migrateSystemPoolOrderForInvoiceRow(tx as never, {
      orderNo: 'AB-13B',
      targetInvoice: { id: 'invoice-990', invNo: '0000990' },
      authoritativeAmount: 20000,
      targetOrderId: null,
      customer,
      operationSource: 'INVOICE_WRITE',
    });

    expect(mockFindOrder).toHaveBeenCalledWith(tx, 'AB-13B', {
      invoice: { invNo: { in: ['DEPOSIT_POOL', 'Un_Associated'] } },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'deposit-order' },
      data: expect.objectContaining({
        invoiceId: 'invoice-990',
        orderNo: 'AB-13B',
        amount: 20000,
        customerId: 'customer-ab',
      }),
    });
    expect(tx.receipt.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'deposit-order' },
      data: {
        invNo: '0000990',
        orderNo: 'AB-13B',
        customerId: 'customer-ab',
        customerMark: 'AB',
        customerName: 'Alpha Buyer',
        customerPhone: '+224600000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
      },
    });
    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(mockSyncOrderAliases).toHaveBeenCalledWith(tx, 'deposit-order', 'AB-13B');
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('deposit-order', tx);
    expect(result).toEqual({
      targetOrderId: 'deposit-order',
      audit: {
        sourceOrderId: 'deposit-order',
        sourcePool: 'DEPOSIT_POOL',
        targetInvoiceId: 'invoice-990',
        targetInvNo: '0000990',
        targetOrderId: 'deposit-order',
        movedReceiptCount: 1,
        amountBefore: 0,
        amountAfter: 20000,
        balanceBefore: -4000,
        balanceAfter: 16000,
        operationSource: 'INVOICE_WRITE',
      },
    });
  });

  it('merges a pool row into an existing target without adding the pool amount', async () => {
    const tx = makeTx();
    mockFindOrder.mockResolvedValueOnce('deposit-order');
    tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'deposit-order',
        orderNo: 'AB-13B',
        amount: 20000,
        orderBalance: 12000,
        invoice: { invNo: 'DEPOSIT_POOL' },
      })
      .mockResolvedValueOnce({ amount: 20000, orderBalance: 9000 });
    tx.receipt.count.mockResolvedValueOnce(2);
    tx.receipt.updateMany.mockResolvedValueOnce({ count: 2 });
    tx.order.delete.mockResolvedValueOnce({ id: 'deposit-order' });

    const result = await migrateSystemPoolOrderForInvoiceRow(tx as never, {
      orderNo: 'AB-13B',
      targetInvoice: { id: 'invoice-990', invNo: '0000990' },
      authoritativeAmount: 20000,
      targetOrderId: 'formal-order',
      customer,
      operationSource: 'BULK_IMPORT',
    });

    expect(tx.receipt.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'deposit-order' },
      data: {
        orderId: 'formal-order',
        invNo: '0000990',
        orderNo: 'AB-13B',
        customerId: 'customer-ab',
        customerMark: 'AB',
        customerName: 'Alpha Buyer',
        customerPhone: '+224600000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
      },
    });
    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'deposit-order' } });
    expect(tx.order.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: { increment: 20000 } }),
    }));
    expect(mockUpdateOrderBalance).toHaveBeenCalledTimes(1);
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('formal-order', tx);
    expect(result).toEqual(expect.objectContaining({
      targetOrderId: 'formal-order',
      audit: expect.objectContaining({
        sourceOrderId: 'deposit-order',
        sourcePool: 'DEPOSIT_POOL',
        amountBefore: 20000,
        amountAfter: 20000,
        movedReceiptCount: 2,
        operationSource: 'BULK_IMPORT',
      }),
    }));
  });

  it('does nothing when no matching system-pool order exists', async () => {
    const tx = makeTx();
    mockFindOrder.mockResolvedValueOnce(null);

    await expect(migrateSystemPoolOrderForInvoiceRow(tx as never, {
      orderNo: 'AB-13B',
      targetInvoice: { id: 'invoice-990', invNo: '0000990' },
      authoritativeAmount: 20000,
      targetOrderId: null,
      customer,
      operationSource: 'INVOICE_WRITE',
    })).resolves.toBeNull();

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(mockUpdateOrderBalance).not.toHaveBeenCalled();
  });

  it('never migrates an order when the target is itself a system pool', async () => {
    const tx = makeTx();

    await expect(migrateSystemPoolOrderForInvoiceRow(tx as never, {
      orderNo: 'AB-13B',
      targetInvoice: { id: 'deposit-invoice', invNo: 'DEPOSIT_POOL' },
      authoritativeAmount: 20000,
      targetOrderId: 'deposit-order',
      customer,
      operationSource: 'INVOICE_WRITE',
    })).resolves.toBeNull();

    expect(mockFindOrder).not.toHaveBeenCalled();
    expect(tx.receipt.updateMany).not.toHaveBeenCalled();
    expect(tx.order.delete).not.toHaveBeenCalled();
  });

  it('previews unique formal matches as automatic and unresolved positive rows as manual', async () => {
    const tx = makeTx();
    tx.order.findMany.mockResolvedValueOnce([
      {
        id: 'pool-unique',
        orderNo: 'AB-12',
        amount: 10000,
        orderBalance: 8000,
        invoice: { invNo: 'DEPOSIT_POOL' },
        _count: { receipts: 1 },
      },
      {
        id: 'pool-manual',
        orderNo: 'AB-13B',
        amount: 18000,
        orderBalance: 14000,
        invoice: { invNo: 'DEPOSIT_POOL' },
        _count: { receipts: 1 },
      },
      {
        id: 'pool-zero',
        orderNo: 'AB-14',
        amount: 0,
        orderBalance: 0,
        invoice: { invNo: 'Un_Associated' },
        _count: { receipts: 0 },
      },
    ]);
    tx.invoice.findMany.mockResolvedValueOnce([
      { id: 'invoice-1', invNo: 'INV-001' },
      { id: 'invoice-2', invNo: 'INV-002' },
    ]);
    mockFindOrder
      .mockResolvedValueOnce('formal-1')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.order.findUnique.mockResolvedValueOnce({
      id: 'formal-1',
      invoiceId: 'invoice-1',
      invoice: { invNo: 'INV-001' },
    });

    const result = await previewSystemPoolRepairs(tx as never, {
      orderWhere: { createdBy: { in: ['sales-1'] } },
      invoiceWhere: { createdBy: { in: ['sales-1'] } },
    });

    expect(result).toEqual({
      poolRepairs: [
        expect.objectContaining({
          sourceOrderId: 'pool-unique',
          repairMode: 'AUTO',
          targetOrderId: 'formal-1',
          targetInvoiceId: 'invoice-1',
          targetInvNo: 'INV-001',
        }),
        expect.objectContaining({
          sourceOrderId: 'pool-manual',
          repairMode: 'MANUAL',
          targetOrderId: null,
          targetInvoiceId: null,
          targetInvNo: null,
        }),
      ],
      targetInvoices: [
        { id: 'invoice-1', invNo: 'INV-001' },
        { id: 'invoice-2', invNo: 'INV-002' },
      ],
    });
    expect(mockFindOrder).toHaveBeenNthCalledWith(2, tx, 'AB-12', {
      AND: [
        { createdBy: { in: ['sales-1'] } },
        { invoice: { invNo: { notIn: ['DEPOSIT_POOL', 'Un_Associated'] } } },
        { id: { not: 'formal-1' } },
      ],
    });
    expect(result.poolRepairs.some((row) => row.sourceOrderId === 'pool-zero')).toBe(false);
  });

  it('moves an explicitly selected manual repair into a visible formal invoice', async () => {
    const tx = makeTx();
    tx.order.findMany.mockResolvedValueOnce([{
      id: 'pool-manual',
      orderNo: 'AB-13B',
      amount: 18000,
      orderBalance: 14000,
      invoice: { invNo: 'DEPOSIT_POOL' },
      _count: { receipts: 1 },
    }]);
    tx.invoice.findMany.mockResolvedValueOnce([{ id: 'invoice-2', invNo: 'INV-002' }]);
    mockFindOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.order.findFirst.mockResolvedValueOnce({
      id: 'pool-manual',
      orderNo: 'AB-13B',
      amount: 18000,
      orderBalance: 14000,
      customerId: 'customer-ab',
      customerMark: 'AB',
      customerName: 'Alpha Buyer',
      customerPhone: '+224600000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      invoice: { invNo: 'DEPOSIT_POOL' },
    });
    tx.invoice.findFirst.mockResolvedValueOnce({ id: 'invoice-2', invNo: 'INV-002' });
    tx.order.findUnique.mockResolvedValueOnce({ amount: 18000, orderBalance: 14000 });
    tx.receipt.count.mockResolvedValueOnce(1);

    const result = await applySystemPoolRepairs(tx as never, {
      orderWhere: { createdBy: { in: ['sales-1'] } },
      invoiceWhere: { createdBy: { in: ['sales-1'] } },
      poolResolutions: [{ sourceOrderId: 'pool-manual', targetInvoiceId: 'invoice-2' }],
      requireAllManual: true,
    });

    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pool-manual' },
      data: expect.objectContaining({
        invoiceId: 'invoice-2',
        amount: 18000,
      }),
    }));
    expect(result).toEqual({
      autoMigrations: [],
      manualMigrations: [expect.objectContaining({
        sourceOrderId: 'pool-manual',
        targetInvoiceId: 'invoice-2',
        amountBefore: 18000,
        amountAfter: 18000,
        operationSource: 'REMATCH_MANUAL',
      })],
      skipped: 0,
      unresolvedManual: 0,
    });
  });

  it('automatically merges a uniquely matched pool order without adding its amount', async () => {
    const tx = makeTx();
    tx.order.findMany.mockResolvedValueOnce([{
      id: 'pool-auto',
      orderNo: 'AB-12',
      amount: 10000,
      orderBalance: 8000,
      invoice: { invNo: 'DEPOSIT_POOL' },
      _count: { receipts: 1 },
    }]);
    tx.invoice.findMany.mockResolvedValueOnce([{ id: 'invoice-1', invNo: 'INV-001' }]);
    mockFindOrder
      .mockResolvedValueOnce('formal-1')
      .mockResolvedValueOnce(null);
    tx.order.findUnique
      .mockResolvedValueOnce({
        id: 'formal-1',
        invoiceId: 'invoice-1',
        invoice: { invNo: 'INV-001' },
      })
      .mockResolvedValueOnce({ amount: 25000, orderBalance: 17000 });
    tx.order.findFirst
      .mockResolvedValueOnce({
        id: 'pool-auto',
        orderNo: 'AB-12',
        amount: 10000,
        orderBalance: 8000,
        customerId: 'customer-ab',
        customerMark: 'AB',
        customerName: 'Alpha Buyer',
        customerPhone: '+224600000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        invoice: { invNo: 'DEPOSIT_POOL' },
      })
      .mockResolvedValueOnce({
        id: 'formal-1',
        orderNo: 'AB-12',
        amount: 25000,
        orderBalance: 19000,
        customerId: 'customer-ab',
        customerMark: 'AB',
        customerName: 'Alpha Buyer',
        customerPhone: '+224600000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        invoice: { id: 'invoice-1', invNo: 'INV-001' },
      });
    tx.receipt.count.mockResolvedValueOnce(1);

    const result = await applySystemPoolRepairs(tx as never, {
      orderWhere: { createdBy: { in: ['sales-1'] } },
      invoiceWhere: { createdBy: { in: ['sales-1'] } },
      poolResolutions: [],
      requireAllManual: false,
    });

    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'pool-auto' } });
    expect(tx.order.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: expect.anything() }),
    }));
    expect(result.autoMigrations).toEqual([
      expect.objectContaining({
        sourceOrderId: 'pool-auto',
        targetOrderId: 'formal-1',
        amountBefore: 10000,
        amountAfter: 25000,
        operationSource: 'REMATCH_AUTO',
      }),
    ]);
  });

  it('rejects an invisible or system-pool manual target without writes', async () => {
    const tx = makeTx();
    tx.order.findMany.mockResolvedValueOnce([{
      id: 'pool-manual',
      orderNo: 'AB-13B',
      amount: 18000,
      orderBalance: 14000,
      invoice: { invNo: 'DEPOSIT_POOL' },
      _count: { receipts: 1 },
    }]);
    tx.invoice.findMany.mockResolvedValueOnce([]);
    mockFindOrder.mockResolvedValueOnce(null);
    tx.order.findFirst.mockResolvedValueOnce({
      id: 'pool-manual',
      orderNo: 'AB-13B',
      amount: 18000,
      orderBalance: 14000,
      customerId: 'customer-ab',
      customerMark: 'AB',
      customerName: 'Alpha Buyer',
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: false,
      invoice: { invNo: 'DEPOSIT_POOL' },
    });
    tx.invoice.findFirst.mockResolvedValueOnce(null);

    await expect(applySystemPoolRepairs(tx as never, {
      orderWhere: { createdBy: { in: ['sales-1'] } },
      invoiceWhere: { createdBy: { in: ['sales-1'] } },
      poolResolutions: [{ sourceOrderId: 'pool-manual', targetInvoiceId: 'hidden-invoice' }],
      requireAllManual: true,
    })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(tx.receipt.updateMany).not.toHaveBeenCalled();
  });

  it('treats a repeated resolution for an already moved source as an idempotent skip', async () => {
    const tx = makeTx();
    tx.order.findMany.mockResolvedValueOnce([]);
    tx.invoice.findMany.mockResolvedValueOnce([{ id: 'invoice-2', invNo: 'INV-002' }]);

    const result = await applySystemPoolRepairs(tx as never, {
      orderWhere: { createdBy: { in: ['sales-1'] } },
      invoiceWhere: { createdBy: { in: ['sales-1'] } },
      poolResolutions: [{ sourceOrderId: 'pool-manual', targetInvoiceId: 'invoice-2' }],
      requireAllManual: true,
    });

    expect(result).toEqual({
      autoMigrations: [],
      manualMigrations: [],
      skipped: 1,
      unresolvedManual: 0,
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.receipt.updateMany).not.toHaveBeenCalled();
  });
});
