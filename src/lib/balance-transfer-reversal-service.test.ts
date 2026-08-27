import { ReceiptStatus, UserRole } from '@prisma/client';
import {
  inspectReceiptEditTransferImpact,
  reverseBalanceTransferInTransaction,
} from '@/lib/balance-transfer-reversal-service';
import { calculateLiveOrderBalance, updateOrderBalance } from '@/lib/order-balance-service';

jest.mock('@/lib/order-balance-service', () => ({
  calculateLiveOrderBalance: jest.fn(),
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockCalculateLiveOrderBalance = calculateLiveOrderBalance as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;

function makeUser(role: UserRole = UserRole.ADMIN) {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role,
    level: 1,
    parentId: null,
    createdById: null,
  };
}

function makeTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'transfer-1',
    fromOrderId: 'source-order',
    toOrderId: 'target-order',
    generatedReceiptId: 'synthetic-receipt',
    amount: 3213,
    createdBy: 'admin-1',
    createdAt: new Date('2026-08-27T01:34:41.928Z'),
    fromOrder: {
      id: 'source-order',
      orderNo: 'Super DT2-08 B',
      amount: 3213,
      orderBalance: 3213,
      invoice: { id: 'unassociated-invoice', invNo: 'Un_Associated' },
    },
    toOrder: {
      id: 'target-order',
      orderNo: 'SUPER DT2-08B',
      amount: 13666,
      orderBalance: 7240,
      invoice: { id: 'formal-invoice', invNo: 'L25MH090002B' },
    },
    generatedReceipt: {
      id: 'synthetic-receipt',
      receiptNo: 'TRANSFER-1787794481934',
      usd: 3213,
      orderId: 'target-order',
      status: ReceiptStatus.Bank_Transfer,
      isMerged: false,
      mergedToId: null,
      detailItems: [],
      histories: [],
      editRequests: [],
      generatorSession: null,
    },
    ...overrides,
  };
}

function makeTx() {
  return {
    balanceTransfer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    receipt: {
      delete: jest.fn().mockResolvedValue({ id: 'synthetic-receipt' }),
    },
    order: {
      update: jest.fn().mockResolvedValue({ id: 'source-order' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'source-order',
        amount: 0,
        orderBalance: 0,
        invoice: { id: 'unassociated-invoice', invNo: 'Un_Associated' },
        receipts: [],
        mergedReceipts: [],
        orderTrackers: [],
        balanceTransfersFrom: [],
        balanceTransfersTo: [],
      }),
      delete: jest.fn().mockResolvedValue({ id: 'source-order' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}

describe('balance-transfer-reversal-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalculateLiveOrderBalance
      .mockResolvedValueOnce(3213)
      .mockResolvedValueOnce(7240);
    mockUpdateOrderBalance.mockImplementation(async (orderId: string) => {
      const computed = orderId === 'source-order' ? 0 : 10453;
      return {
        repaired: true,
        comparison: { matches: false, stored: orderId === 'source-order' ? 3213 : 7240, computed, difference: computed },
        stored: orderId === 'source-order' ? 3213 : 7240,
        computed,
        difference: computed,
      };
    });
  });

  it('detects one exact linked transfer for a receipt edit', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findMany.mockResolvedValue([makeTransfer()]);

    const result = await inspectReceiptEditTransferImpact(tx as never, {
      receiptId: 'real-receipt',
      currentOrderId: 'source-order',
      nextOrderId: 'target-order',
      amount: 3213,
    });

    expect(result).toEqual({
      balanceTransferId: 'transfer-1',
      generatedReceiptId: 'synthetic-receipt',
      transferReceiptNo: 'TRANSFER-1787794481934',
      sourceOrderId: 'source-order',
      sourceOrderNo: 'Super DT2-08 B',
      targetOrderId: 'target-order',
      targetOrderNo: 'SUPER DT2-08B',
      amount: 3213,
    });
  });

  it('does not treat an unlinked TRANSFER prefix as reversible', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findMany.mockResolvedValue([
      makeTransfer({ generatedReceiptId: null, generatedReceipt: null }),
    ]);

    await expect(inspectReceiptEditTransferImpact(tx as never, {
      receiptId: 'real-receipt',
      currentOrderId: 'source-order',
      nextOrderId: 'target-order',
      amount: 3213,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('blocks ambiguous edit-time transfer matches', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findMany.mockResolvedValue([
      makeTransfer(),
      makeTransfer({ id: 'transfer-2', generatedReceiptId: 'synthetic-receipt-2' }),
    ]);

    await expect(inspectReceiptEditTransferImpact(tx as never, {
      receiptId: 'real-receipt',
      currentOrderId: 'source-order',
      nextOrderId: 'target-order',
      amount: 3213,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reverses the incident-equivalent transfer and deletes the empty pool order', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findUnique.mockResolvedValue(makeTransfer());

    const result = await reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    });

    expect(tx.balanceTransfer.deleteMany).toHaveBeenCalledWith({
      where: { id: 'transfer-1', generatedReceiptId: 'synthetic-receipt' },
    });
    expect(tx.receipt.delete).toHaveBeenCalledWith({ where: { id: 'synthetic-receipt' } });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'source-order' },
      data: { amount: { decrement: 3213 } },
    });
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('source-order', tx, expect.any(Object));
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('target-order', tx, expect.any(Object));
    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'source-order' } });
    expect(result).toMatchObject({
      sourceAmountBefore: 3213,
      sourceAmountAfter: 0,
      sourceBalanceBefore: 3213,
      sourceBalanceAfter: 0,
      targetBalanceBefore: 7240,
      targetBalanceAfter: 10453,
      sourceOrderDeleted: true,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ORDER_TRANSFER_BALANCE_REVERSE',
        targetId: 'transfer-1',
        metadata: expect.objectContaining({
          generatedReceiptId: 'synthetic-receipt',
          targetBalanceAfter: 10453,
        }),
      }),
    });
  });

  it('retains a formal source order after reversing its amount', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findUnique.mockResolvedValue(makeTransfer({
      fromOrder: {
        ...makeTransfer().fromOrder,
        invoice: { id: 'formal-source', invNo: 'L25MH000001' },
      },
    }));

    const result = await reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    });

    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(result.sourceOrderDeleted).toBe(false);
  });

  it('retains a pool order that still has protected references', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findUnique.mockResolvedValue(makeTransfer());
    tx.order.findUnique.mockResolvedValue({
      id: 'source-order',
      amount: 0,
      orderBalance: 0,
      invoice: { id: 'unassociated-invoice', invNo: 'Un_Associated' },
      receipts: [{ id: 'other-receipt' }],
      mergedReceipts: [],
      orderTrackers: [],
      balanceTransfersFrom: [],
      balanceTransfersTo: [],
    });

    const result = await reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    });

    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(result.sourceOrderDeleted).toBe(false);
  });

  it('denies non-admin reversal before changing data', async () => {
    const tx = makeTx();

    await expect(reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(UserRole.SALES),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(tx.balanceTransfer.findUnique).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('does not decrement the source amount when another call already claimed the transfer', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findUnique.mockResolvedValue(makeTransfer());
    tx.balanceTransfer.deleteMany.mockResolvedValue({ count: 0 });

    await expect(reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(tx.receipt.delete).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('propagates strict audit failure to the transaction caller', async () => {
    const tx = makeTx();
    tx.balanceTransfer.findUnique.mockResolvedValue(makeTransfer());
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(reverseBalanceTransferInTransaction(tx as never, {
      currentUser: makeUser(),
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'ADMIN_RECEIPT_ACTION',
    })).rejects.toThrow('audit unavailable');
  });
});
