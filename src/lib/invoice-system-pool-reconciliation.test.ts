import { migrateSystemPoolOrderForInvoiceRow } from '@/lib/invoice-system-pool-reconciliation';
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
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    receipt: {
      count: jest.fn(),
      updateMany: jest.fn(),
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
});
