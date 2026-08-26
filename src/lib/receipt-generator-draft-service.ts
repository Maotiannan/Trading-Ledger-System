import { Prisma, ReceiptGeneratorSessionStatus, ReceiptStatus } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import { calculateLiveOrderBalance } from '@/lib/order-balance-service';
import {
  buildReceiptGeneratorLayout,
  normalizeReceiptGeneratorFraisStatus,
  normalizeReceiptGeneratorPaymentMode,
  normalizeReceiptGeneratorPaymentType,
  normalizeReceiptGeneratorReceivedBy,
} from '@/lib/receipt-generator-layout';
import type { DbTransactionClient } from '@/lib/transaction';

type PendingReceiptGeneratorDraftClient = Pick<
  DbTransactionClient,
  'customer' | 'order' | 'receiptGeneratorSession'
>;

export type PendingReceiptGeneratorDraftInput = {
  receiptId: string;
  status: ReceiptStatus;
  receiptNo: string | null;
  date: Date | null;
  orderId: string | null;
  orderNo: string | null;
  invNo: string | null;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  payer: string | null;
  tel: string | null;
};

function snapshotRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: string | null, message: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createApiError({ code: 'BAD_REQUEST', status: 400, message });
  }
  return normalized;
}

export async function syncPendingReceiptGeneratorDraft(
  client: PendingReceiptGeneratorDraftClient,
  input: PendingReceiptGeneratorDraftInput,
): Promise<void> {
  if (input.status !== ReceiptStatus.SIGNING_PENDING) return;

  const receiptNo = requiredText(input.receiptNo, '待签字收据的收据号不能为空');
  const orderNo = requiredText(input.orderNo, '待签字收据的ORDER NO不能为空');
  const session = await client.receiptGeneratorSession.findFirst({
    where: {
      receiptId: input.receiptId,
      status: ReceiptGeneratorSessionStatus.PENDING,
    },
  });

  if (!session) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '待签字收据缺少有效签字会话，无法修改',
      detail: { receiptId: input.receiptId },
    });
  }

  const snapshot = snapshotRecord(session.layoutSnapshot);
  const customer = input.customerId
    ? await client.customer.findUnique({
        where: { id: input.customerId },
        select: { companyName: true, name: true },
      })
    : null;
  const customerName = input.customerName || customer?.name || session.customerName;
  let customerCompanyName: string | null = null;
  if (customer) {
    customerCompanyName = customer.companyName;
  } else if (input.customerId === session.customerId && typeof snapshot.customerCompanyName === 'string') {
    customerCompanyName = snapshot.customerCompanyName;
  }
  const balanceBefore = input.orderId
    ? await calculateLiveOrderBalance(input.orderId, client)
    : null;
  const layout = buildReceiptGeneratorLayout({
    receiptNo,
    orderNo,
    invNo: input.invNo,
    customerMark: input.customerMark,
    customerCompanyName,
    customerName,
    clientNameOverride: input.payer,
    clientTel: input.tel,
    usdAmount: Number(session.usd),
    balanceBefore,
    paymentMode: normalizeReceiptGeneratorPaymentMode(snapshot.paymentMode),
    fraisStatus: normalizeReceiptGeneratorFraisStatus(snapshot.fraisStatus),
    paymentType: normalizeReceiptGeneratorPaymentType(snapshot.paymentType),
    receivedBy: normalizeReceiptGeneratorReceivedBy(snapshot.receivedBy),
    generatedAt: input.date || session.createdAt,
  });

  const updateResult = await client.receiptGeneratorSession.updateMany({
    where: {
      id: session.id,
      receiptId: input.receiptId,
      status: ReceiptGeneratorSessionStatus.PENDING,
    },
    data: {
      receiptNo,
      orderNo,
      invNo: input.invNo,
      customerId: input.customerId,
      customerMark: input.customerMark,
      customerName,
      clientTel: input.tel,
      balanceBefore: layout.balanceBefore,
      balanceAfter: layout.balanceAfter,
      amountInWords: layout.amountInWords,
      motif: layout.motif,
      layoutSnapshot: layout as unknown as Prisma.InputJsonValue,
    },
  });

  if (updateResult.count !== 1) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '待签字收据的签字状态已变化，请刷新后重试',
      detail: { receiptId: input.receiptId, sessionId: session.id },
    });
  }
}
