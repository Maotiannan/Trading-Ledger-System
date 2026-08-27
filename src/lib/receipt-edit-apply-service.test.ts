import { ReceiptStatus, UserRole } from '@prisma/client';
import { recordAuditEventInTransaction } from '@/lib/audit';
import {
  cleanupSafeSystemPoolSourceOrderInTransaction,
  inspectReceiptEditTransferImpact,
  reverseBalanceTransferInTransaction,
} from '@/lib/balance-transfer-reversal-service';
import { updateOrderBalance } from '@/lib/order-balance-service';
import {
  resolveReceiptEditBinding,
  syncReceiptDetailItemsForBinding,
} from '@/lib/receipt-edit-binding';
import { applyReceiptEditInTransaction } from '@/lib/receipt-edit-apply-service';
import { syncPendingReceiptGeneratorDraft } from '@/lib/receipt-generator-draft-service';

jest.mock('@/lib/audit', () => ({
  recordAuditEventInTransaction: jest.fn(),
}));

jest.mock('@/lib/balance-transfer-reversal-service', () => ({
  cleanupSafeSystemPoolSourceOrderInTransaction: jest.fn(),
  inspectReceiptEditTransferImpact: jest.fn(),
  reverseBalanceTransferInTransaction: jest.fn(),
}));

jest.mock('@/lib/order-balance-service', () => ({
  updateOrderBalance: jest.fn(),
}));

jest.mock('@/lib/receipt-edit-binding', () => ({
  resolveReceiptEditBinding: jest.fn(),
  syncReceiptDetailItemsForBinding: jest.fn(),
}));

jest.mock('@/lib/receipt-generator-draft-service', () => ({
  syncPendingReceiptGeneratorDraft: jest.fn(),
}));

const mockRecordAudit = recordAuditEventInTransaction as jest.Mock;
const mockInspectTransfer = inspectReceiptEditTransferImpact as jest.Mock;
const mockReverseTransfer = reverseBalanceTransferInTransaction as jest.Mock;
const mockCleanupPoolOrder = cleanupSafeSystemPoolSourceOrderInTransaction as jest.Mock;
const mockUpdateOrderBalance = updateOrderBalance as jest.Mock;
const mockResolveBinding = resolveReceiptEditBinding as jest.Mock;
const mockSyncDetail = syncReceiptDetailItemsForBinding as jest.Mock;
const mockSyncDraft = syncPendingReceiptGeneratorDraft as jest.Mock;

const admin = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
};

const patch = {
  receiptNo: '0001170',
  date: '2026-08-27',
  orderNo: 'SUPER DT2-08B',
  invNo: 'L25MH090002B',
  customerMark: 'SUPER DT2',
  payer: 'Customer "SUPER DT2"',
  tel: '+224000000000',
};

const existingReceipt = {
  id: 'real-receipt',
  receiptNo: '0001170',
  date: new Date('2026-08-20T00:00:00.000Z'),
  tel: '+224111111111',
  usd: 3213,
  invNo: null,
  orderNo: 'Super DT2-08 B',
  payer: 'Old Customer',
  status: ReceiptStatus.RECEIVED,
  imageUrl: '/upload/receipt.jpg',
  imageName: 'receipt.jpg',
  isDeposit: false,
  customerId: 'customer-1',
  customerMark: 'SUPER DT2',
  customerName: 'Customer',
  customerPhone: '+224111111111',
  customerCity: 'Conakry',
  needsCustomerFix: false,
  orderId: 'source-order',
};

const impact = {
  balanceTransferId: 'transfer-1',
  generatedReceiptId: 'synthetic-receipt',
  transferReceiptNo: 'TRANSFER-1787794481934',
  sourceOrderId: 'source-order',
  sourceOrderNo: 'Super DT2-08 B',
  targetOrderId: 'target-order',
  targetOrderNo: 'SUPER DT2-08B',
  amount: 3213,
};

function makeTx() {
  return {
    receipt: {
      findUnique: jest.fn().mockResolvedValue(existingReceipt),
      update: jest.fn().mockResolvedValue({ ...existingReceipt, ...patch, orderId: 'target-order' }),
    },
    receiptHistory: {
      create: jest.fn().mockResolvedValue({ id: 'history-1' }),
    },
    detailItem: {
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };
}

function makeInput(tx: ReturnType<typeof makeTx>, expectedBalanceTransferId?: string | null) {
  return {
    tx: tx as never,
    currentUser: admin,
    ownerIds: ['admin-1', 'sales-1'],
    receiptId: 'real-receipt',
    patch,
    nextDate: new Date('2026-08-27T00:00:00.000Z'),
    historyNote: '重新识别前保存',
    source: 'DIRECT_ADMIN_EDIT',
    expectedBalanceTransferId,
  };
}

describe('receipt-edit-apply-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveBinding.mockResolvedValue({
      orderId: 'target-order',
      orderNo: 'SUPER DT2-08B',
      invNo: 'L25MH090002B',
      matchedCustomer: {
        customerId: 'customer-1',
        customerMark: 'SUPER DT2',
        customerName: 'Customer',
        customerPhone: '+224000000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
      },
    });
    mockInspectTransfer.mockResolvedValue(null);
    mockReverseTransfer.mockResolvedValue({ sourceOrderDeleted: false });
    mockCleanupPoolOrder.mockResolvedValue(true);
    mockUpdateOrderBalance.mockResolvedValue({ computed: 0 });
  });

  it('applies a normal edit without transfer reversal', async () => {
    const tx = makeTx();

    const result = await applyReceiptEditInTransaction(makeInput(tx));

    expect(tx.receipt.findUnique).toHaveBeenCalledWith({ where: { id: 'real-receipt' } });
    expect(mockReverseTransfer).not.toHaveBeenCalled();
    expect(tx.receiptHistory.create).toHaveBeenCalled();
    expect(tx.receipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'real-receipt' },
      data: expect.objectContaining({
        orderId: 'target-order',
        orderNo: 'SUPER DT2-08B',
        invNo: 'L25MH090002B',
      }),
    }));
    expect(mockSyncDetail).toHaveBeenCalled();
    expect(mockSyncDraft).toHaveBeenCalled();
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('source-order', tx, expect.any(Object));
    expect(mockUpdateOrderBalance).toHaveBeenCalledWith('target-order', tx, expect.any(Object));
    expect(result).toMatchObject({
      touchedOrderIds: ['source-order', 'target-order'],
      reversedTransferId: null,
    });
  });

  it('returns confirmation-required before any receipt edit write', async () => {
    const tx = makeTx();
    mockInspectTransfer.mockResolvedValueOnce(impact);

    await expect(applyReceiptEditInTransaction(makeInput(tx))).rejects.toMatchObject({
      code: 'RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED',
      status: 409,
      detail: {
        balanceTransferId: 'transfer-1',
        transferReceiptNo: 'TRANSFER-1787794481934',
        sourceOrderNo: 'Super DT2-08 B',
        targetOrderNo: 'SUPER DT2-08B',
        amount: 3213,
      },
    });

    expect(mockReverseTransfer).not.toHaveBeenCalled();
    expect(tx.receiptHistory.create).not.toHaveBeenCalled();
    expect(tx.receipt.update).not.toHaveBeenCalled();
    expect(mockSyncDetail).not.toHaveBeenCalled();
  });

  it('revalidates and reverses the expected transfer before rebinding', async () => {
    const tx = makeTx();
    mockInspectTransfer.mockResolvedValueOnce(impact);

    const result = await applyReceiptEditInTransaction(makeInput(tx, 'transfer-1'));

    expect(mockReverseTransfer).toHaveBeenCalledWith(tx, {
      currentUser: admin,
      balanceTransferId: 'transfer-1',
      expectedGeneratedReceiptId: 'synthetic-receipt',
      source: 'DIRECT_ADMIN_EDIT',
      deferSourceCleanup: true,
    });
    expect(mockReverseTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      tx.receipt.update.mock.invocationCallOrder[0],
    );
    expect(mockCleanupPoolOrder).toHaveBeenCalledWith(tx, 'source-order');
    expect(result.reversedTransferId).toBe('transfer-1');
    expect(mockRecordAudit).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: 'RECEIPT_UPDATE_WITH_TRANSFER_REVERSAL',
      targetId: 'real-receipt',
    }));
  });

  it('rejects a stale or wrong expected transfer ID', async () => {
    const tx = makeTx();
    mockInspectTransfer.mockResolvedValueOnce(impact);

    await expect(applyReceiptEditInTransaction(makeInput(tx, 'transfer-stale'))).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    expect(mockReverseTransfer).not.toHaveBeenCalled();
    expect(tx.receipt.update).not.toHaveBeenCalled();
  });

  it.each([
    ['history', () => makeTx().receiptHistory.create, 'history unavailable'],
    ['receipt binding', () => makeTx().receipt.update, 'binding unavailable'],
  ])('propagates %s failure to the caller transaction', async (_label, _select, message) => {
    const tx = makeTx();
    if (_label === 'history') tx.receiptHistory.create.mockRejectedValueOnce(new Error(message));
    if (_label === 'receipt binding') tx.receipt.update.mockRejectedValueOnce(new Error(message));

    await expect(applyReceiptEditInTransaction(makeInput(tx))).rejects.toThrow(message);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('propagates detail and draft synchronization failures to the caller transaction', async () => {
    const detailTx = makeTx();
    mockSyncDetail.mockRejectedValueOnce(new Error('detail unavailable'));
    await expect(applyReceiptEditInTransaction(makeInput(detailTx))).rejects.toThrow('detail unavailable');

    jest.clearAllMocks();
    mockResolveBinding.mockResolvedValue({ orderId: 'target-order', orderNo: 'SUPER DT2-08B', invNo: 'L25MH090002B' });
    mockInspectTransfer.mockResolvedValue(null);
    const draftTx = makeTx();
    mockSyncDraft.mockRejectedValueOnce(new Error('draft unavailable'));
    await expect(applyReceiptEditInTransaction(makeInput(draftTx))).rejects.toThrow('draft unavailable');
  });
});
