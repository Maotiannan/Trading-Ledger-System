import type { DbTransactionClient } from '@/lib/transaction';

export async function pauseWhatsAppForDeletion(tx: DbTransactionClient, targetType: string, targetId: string) {
  const receiptIds = targetType === 'RECEIPT' ? [targetId] : targetType === 'DETAIL'
    ? (await tx.detailItem.findMany({ where: { detailId: targetId }, select: { receiptId: true } })).map(row => row.receiptId).filter((id): id is string => Boolean(id)) : [];
  if (!receiptIds.length) return;
  const sources = await tx.emailNotification.findMany({ where: { receiptId: { in: receiptIds } }, select: { id: true } });
  await tx.whatsAppDelivery.updateMany({ where: { sourceId: { in: sources.map(source => source.id) }, status: { in: ['PENDING', 'QUEUED', 'PAUSED'] }, claimToken: null },
    data: { status: 'PAUSED', failureCode: 'DELETION_PENDING', approvedAt: null, approvedBy: null } });
}
