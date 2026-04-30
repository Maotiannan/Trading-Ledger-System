import { subHours } from 'date-fns';
import { ReceiptGeneratorSessionStatus, ReceiptStatus } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { db } from '@/lib/db';
import { getUploadedAssetCleanupSettings } from '@/lib/system-settings';

export async function cleanupStaleSigningPendingReceipts(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const { signingPendingTtlHours } = await getUploadedAssetCleanupSettings();
  const threshold = subHours(now, signingPendingTtlHours);

  const staleSessions = await db.receiptGeneratorSession.findMany({
    where: {
      status: ReceiptGeneratorSessionStatus.PENDING,
      createdAt: { lte: threshold },
      finalImageUrl: null,
      receipt: {
        is: {
          status: ReceiptStatus.SIGNING_PENDING,
          imageUrl: null,
        },
      },
    },
    include: {
      receipt: true,
    },
  });

  let cancelledSessions = 0;
  let deletedReceipts = 0;

  for (const session of staleSessions) {
    await db.$transaction(async (tx) => {
      await tx.receiptGeneratorSession.update({
        where: { id: session.id },
        data: { status: ReceiptGeneratorSessionStatus.CANCELLED },
      });
      await tx.receipt.delete({
        where: { id: session.receiptId },
      });
    });

    cancelledSessions += 1;
    deletedReceipts += 1;

    await recordAuditEvent({
      action: auditActions.RECEIPT_UPDATE,
      actorId: session.createdBy,
      targetType: auditTargetTypes.RECEIPT,
      targetId: session.receiptId,
      metadata: {
        mode: 'generator-stale-signing-cleanup',
        sessionId: session.id,
        receiptNo: session.receiptNo,
        cancelledAt: now.toISOString(),
        threshold: threshold.toISOString(),
      },
    });
  }

  return {
    cancelledSessions,
    deletedReceipts,
  };
}
