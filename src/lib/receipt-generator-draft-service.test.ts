import { ReceiptGeneratorSessionStatus, ReceiptStatus } from '@prisma/client';
import { calculateLiveOrderBalance } from '@/lib/order-balance-service';
import { syncPendingReceiptGeneratorDraft } from '@/lib/receipt-generator-draft-service';

jest.mock('@/lib/order-balance-service', () => ({
  calculateLiveOrderBalance: jest.fn(),
}));

const mockCalculateLiveOrderBalance = calculateLiveOrderBalance as jest.Mock;

function makeTx() {
  return {
    receiptGeneratorSession: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
    },
  };
}

const pendingDraft = {
  receiptId: 'receipt-1',
  status: ReceiptStatus.SIGNING_PENDING,
  receiptNo: '0010010',
  date: new Date('2026-08-26T00:00:00.000Z'),
  orderId: 'order-2',
  orderNo: 'KITEM-20',
  invNo: 'INV-2',
  customerId: 'customer-2',
  customerMark: 'KITEM',
  customerName: 'Example Customer',
  payer: 'Example Customer "KITEM"',
  tel: '+224 600 00 00 00',
};

describe('receipt-generator-draft-service', () => {
  it('does not copy a business alias into an empty payer or reuse another customer name', async () => {
    const tx = makeTx();
    tx.receiptGeneratorSession.findFirst.mockResolvedValue({ id: 'session', customerId: 'old-customer', usd: 100,
      customerName: 'Old Person', createdAt: new Date(), layoutSnapshot: {}, status: 'PENDING' });
    tx.customer.findUnique.mockResolvedValue({ name: '', companyName: null });
    tx.receiptGeneratorSession.updateMany.mockResolvedValue({ count: 1 });
    mockCalculateLiveOrderBalance.mockResolvedValue(200);
    await syncPendingReceiptGeneratorDraft(tx as never, { ...pendingDraft, customerName: 'BUSINESS ALIAS', customerMark: 'CURRENT MARK', payer: '' });
    expect(tx.receiptGeneratorSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      customerName: null, layoutSnapshot: expect.objectContaining({ clientName: 'CURRENT MARK' }),
    }) }));
  });
  it.each([null, 'Explicit payer'])('never treats an ORDER_NAME as payer when editing a pending receipt (%s)', async (payer) => {
    const tx = makeTx();
    tx.receiptGeneratorSession.findFirst.mockResolvedValue({ id: 'session', customerId: 'customer-2', usd: 100,
      customerName: 'Previous Person', createdAt: new Date(), layoutSnapshot: {}, status: 'PENDING' });
    tx.customer.findUnique.mockResolvedValue({ name: 'Actual Person', companyName: null });
    tx.receiptGeneratorSession.updateMany.mockResolvedValue({ count: 1 });
    mockCalculateLiveOrderBalance.mockResolvedValue(200);
    await syncPendingReceiptGeneratorDraft(tx as never, { ...pendingDraft, customerName: 'KITEM', payer });
    expect(tx.receiptGeneratorSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      customerName: 'Actual Person', layoutSnapshot: expect.objectContaining({ clientName: payer || 'Actual Person "KITEM"' }),
    }) }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not query generator sessions for a non-pending receipt', async () => {
    const tx = makeTx();

    await syncPendingReceiptGeneratorDraft(tx as never, {
      ...pendingDraft,
      status: ReceiptStatus.SR_Received,
    });

    expect(tx.receiptGeneratorSession.findFirst).not.toHaveBeenCalled();
    expect(tx.receiptGeneratorSession.updateMany).not.toHaveBeenCalled();
    expect(mockCalculateLiveOrderBalance).not.toHaveBeenCalled();
  });

  it.each(['Transferred via bank account', 'Espèces'])('rebuilds the pending generator session while preserving receiver %s', async (receivedBy) => {
    const tx = makeTx();
    tx.receiptGeneratorSession.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0010009',
      orderNo: 'OLD-01',
      invNo: 'INV-OLD',
      customerId: 'customer-old',
      customerMark: 'OLD',
      customerName: 'Old Customer',
      clientTel: '111',
      usd: 500,
      balanceBefore: 900,
      balanceAfter: 400,
      amountInWords: 'Five hundred US dollars only',
      motif: 'Old motif',
      layoutSnapshot: {
        customerCompanyName: 'Old Company',
        paymentMode: 'Virement',
        fraisStatus: 'Non payé',
        paymentType: 'Final',
        receivedBy,
      },
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    tx.customer.findUnique.mockResolvedValueOnce({
      name: 'Example Customer',
      companyName: null,
    });
    mockCalculateLiveOrderBalance.mockResolvedValueOnce(500);
    tx.receiptGeneratorSession.updateMany.mockResolvedValueOnce({ count: 1 });

    await syncPendingReceiptGeneratorDraft(tx as never, pendingDraft);

    expect(tx.receiptGeneratorSession.findFirst).toHaveBeenCalledWith({
      where: {
        receiptId: 'receipt-1',
        status: ReceiptGeneratorSessionStatus.PENDING,
      },
    });
    expect(mockCalculateLiveOrderBalance).toHaveBeenCalledWith('order-2', tx);
    expect(tx.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'customer-2' },
      select: { companyName: true, name: true },
    });
    expect(tx.receiptGeneratorSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        receiptId: 'receipt-1',
        status: ReceiptGeneratorSessionStatus.PENDING,
      },
      data: expect.objectContaining({
        receiptNo: '0010010',
        orderNo: 'KITEM-20',
        invNo: 'INV-2',
        customerId: 'customer-2',
        customerMark: 'KITEM',
        customerName: 'Example Customer',
        clientTel: '+224 600 00 00 00',
        balanceBefore: 500,
        balanceAfter: 0,
        motif: 'Final payment for INV-2 KITEM-20',
        layoutSnapshot: expect.objectContaining({
          receiptNo: '0010010',
          dateText: '26/08/2026',
          orderNo: 'KITEM-20',
          invNo: 'INV-2',
          customerCompanyName: null,
          customerName: 'Example Customer',
          customerMark: 'KITEM',
          clientName: 'Example Customer "KITEM"',
          clientTel: '+224 600 00 00 00',
          usdAmount: 500,
          balanceBefore: 500,
          balanceAfter: 0,
          paymentMode: 'Virement',
          fraisStatus: 'Non payé',
          paymentType: 'Final',
          receivedBy,
        }),
      }),
    });
  });

  it('rejects a pending receipt when its open generator session is missing', async () => {
    const tx = makeTx();
    tx.receiptGeneratorSession.findFirst.mockResolvedValueOnce(null);

    await expect(syncPendingReceiptGeneratorDraft(tx as never, pendingDraft)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: '待签字收据缺少有效签字会话，无法修改',
    });

    expect(tx.receiptGeneratorSession.updateMany).not.toHaveBeenCalled();
    expect(mockCalculateLiveOrderBalance).not.toHaveBeenCalled();
  });

  it('rejects when the signing session is finalized before the draft update is written', async () => {
    const tx = makeTx();
    tx.receiptGeneratorSession.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      receiptId: 'receipt-1',
      receiptNo: '0010009',
      orderNo: 'OLD-01',
      invNo: 'INV-OLD',
      customerId: 'customer-old',
      customerMark: 'OLD',
      customerName: 'Old Customer',
      clientTel: '111',
      usd: 500,
      balanceBefore: 900,
      layoutSnapshot: { paymentType: 'Standard' },
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    tx.customer.findUnique.mockResolvedValueOnce({ name: 'Example Customer', companyName: null });
    mockCalculateLiveOrderBalance.mockResolvedValueOnce(500);
    tx.receiptGeneratorSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(syncPendingReceiptGeneratorDraft(tx as never, pendingDraft)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '待签字收据的签字状态已变化，请刷新后重试',
    });
  });
});
