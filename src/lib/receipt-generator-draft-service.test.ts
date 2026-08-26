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
  orderNo: 'PIKIN-20',
  invNo: 'INV-2',
  customerId: 'customer-2',
  customerMark: 'PIKIN',
  customerName: 'Mamadou Dian Diallo',
  payer: 'Mamadou Dian Diallo "PIKIN"',
  tel: '+224 620 00 00 00',
};

describe('receipt-generator-draft-service', () => {
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

  it('rebuilds the pending generator session while preserving generator-only selections', async () => {
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
        receivedBy: 'Transferred via bank account',
      },
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    tx.customer.findUnique.mockResolvedValueOnce({
      name: 'Mamadou Dian Diallo',
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
        orderNo: 'PIKIN-20',
        invNo: 'INV-2',
        customerId: 'customer-2',
        customerMark: 'PIKIN',
        customerName: 'Mamadou Dian Diallo',
        clientTel: '+224 620 00 00 00',
        balanceBefore: 500,
        balanceAfter: 0,
        motif: 'Final payment for INV-2 PIKIN-20',
        layoutSnapshot: expect.objectContaining({
          receiptNo: '0010010',
          dateText: '26/08/2026',
          orderNo: 'PIKIN-20',
          invNo: 'INV-2',
          customerCompanyName: null,
          customerName: 'Mamadou Dian Diallo',
          customerMark: 'PIKIN',
          clientName: 'Mamadou Dian Diallo "PIKIN"',
          clientTel: '+224 620 00 00 00',
          usdAmount: 500,
          balanceBefore: 500,
          balanceAfter: 0,
          paymentMode: 'Virement',
          fraisStatus: 'Non payé',
          paymentType: 'Final',
          receivedBy: 'Transferred via bank account',
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
    tx.customer.findUnique.mockResolvedValueOnce({ name: 'Mamadou Dian Diallo', companyName: null });
    mockCalculateLiveOrderBalance.mockResolvedValueOnce(500);
    tx.receiptGeneratorSession.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(syncPendingReceiptGeneratorDraft(tx as never, pendingDraft)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '待签字收据的签字状态已变化，请刷新后重试',
    });
  });
});
