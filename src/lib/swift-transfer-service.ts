import { DetailStatus, ReceiptStatus } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { calculateSwiftTransferSummary } from '@/lib/swift-transfer-summary';
import { getNumericSystemSetting } from '@/lib/system-settings';
import { createApiError } from '@/lib/api-error';

export function getSwiftFeePerCopy() {
  return getNumericSystemSetting('SWIFT_MAX_FEE_PER_COPY', 40, { min: 0 });
}

// Serialize all mutations for a payment detail before reading its SWIFT totals.
export async function lockSwiftDetail(tx: DbTransactionClient, detailId: string) {
  await tx.$queryRaw`SELECT id FROM Detail WHERE id = ${detailId} FOR UPDATE`;
}

export async function syncSwiftTransferState(tx: DbTransactionClient, detailId: string, maxFeePerCopy: number) {
  const detail = await tx.detail.findUnique({
    where: { id: detailId },
    include: { swifts: true, items: { select: { receiptId: true } } },
  });
  if (!detail) throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '关联的付款明细不存在' });
  const summary = calculateSwiftTransferSummary(detail.totalAmount, detail.swifts, maxFeePerCopy);
  await tx.detail.update({ where: { id: detailId }, data: { status: summary.status } });
  const receiptIds = detail.items.map((item) => item.receiptId).filter((id): id is string => Boolean(id));
  const receiptStatus = summary.status === DetailStatus.RECEIVED ? ReceiptStatus.RECEIVED
    : summary.status === DetailStatus.Bank_Transfer ? ReceiptStatus.Bank_Transfer : ReceiptStatus.Waiting_SWIFT;
  if (receiptIds.length) {
    await tx.receipt.updateMany({
      where: { id: { in: receiptIds }, status: { not: ReceiptStatus.SIGNING_PENDING } },
      data: { status: receiptStatus },
    });
  }
  return summary;
}
