import { subHours } from 'date-fns';
import { ReceiptGeneratorSessionStatus, ReceiptStatus, UploadedAssetStatus } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { db } from '@/lib/db';
import { getUploadedAssetCleanupSettings } from '@/lib/system-settings';
import { runFinancialTransaction } from '@/lib/transaction';
import { archiveForRecovery, purgeExpiredRecoveryEntries } from '@/lib/recovery-service';
import { lockReceiptBalances } from '@/lib/order-balance-lock';

export async function cleanupExpiredStagedUploadedAssets(input: { now?: Date } = {}) {
  const now = input.now ?? new Date();
  const expiredAssets = await db.uploadedAsset.findMany({
    where: {
      status: UploadedAssetStatus.STAGED,
      expiresAt: { lte: now },
    },
    select: {
      id: true,
      path: true,
    },
  });

  let deletedAssets = 0;

  for (const asset of expiredAssets) {
    const archived = await runFinancialTransaction(async (tx) => {
      const original = await tx.uploadedAsset.findUnique({ where: { id: asset.id } });
      const claimed = await tx.uploadedAsset.updateMany({ where: { id: asset.id, status: 'STAGED', expiresAt: { lte: now } },
        data: { status: 'DELETED', deletedAt: now, expiresAt: null } });
      if (claimed.count !== 1 || !original) return false;
      await archiveForRecovery(tx, { kind: 'STAGED_ASSET', resourceId: original.id, ownerId: original.managedById || original.createdBy,
        snapshot: { asset: original }, files: [original.path], now });
      return true;
    });
    if (archived) deletedAssets += 1;
  }

  return {
    deletedAssets,
  };
}

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
    const receipt = session.receipt;
    if (!receipt) {
      continue;
    }

    let archived = false;
    await runFinancialTransaction(async (tx) => {
      await lockReceiptBalances(tx, [receipt.id]);
      const current = await tx.receiptGeneratorSession.findUnique({ where: { id: session.id }, include: { receipt: true } });
      const claim = await tx.receiptGeneratorSession.updateMany({ where: {
        id: session.id, status: 'PENDING', createdAt: { lte: threshold }, finalImageUrl: null,
        receipt: { is: { status: 'SIGNING_PENDING', imageUrl: null } },
      }, data: { status: 'CANCELLED' } });
      if (claim.count !== 1 || !current?.receipt) return;
      const histories = await tx.receiptHistory.findMany({ where: { receiptId: current.receipt.id } });
      const editRequests = await tx.receiptEditRequest.findMany({ where: { receiptId: current.receipt.id } });
      const { receipt: currentReceipt, ...sessionSnapshot } = current;
      await archiveForRecovery(tx, { kind: 'SIGNING_RECEIPT', resourceId: currentReceipt.id,
        ownerId: currentReceipt.managedById || currentReceipt.createdBy,
        snapshot: { receipt: currentReceipt, session: sessionSnapshot, histories, editRequests },
        files: [current.receiverSignatureUrl, current.payerSignatureUrl].filter((file): file is string => Boolean(file)), now });
      await tx.receiptGeneratorSession.delete({ where: { id: session.id } });
      await tx.receipt.delete({
        where: { id: receipt.id },
      });
      archived = true;
    });
    if (!archived) continue;
    cancelledSessions += 1;
    deletedReceipts += 1;

    await recordAuditEvent({
      action: auditActions.RECEIPT_UPDATE,
      actorId: session.createdBy,
      targetType: auditTargetTypes.RECEIPT,
      targetId: receipt.id,
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

export async function runUploadedAssetMaintenance(input: { now?: Date } = {}) {
  const stagedAssetCleanup = await cleanupExpiredStagedUploadedAssets(input);
  const staleSigningCleanup = await cleanupStaleSigningPendingReceipts(input);
  const recoveryPurge = await purgeExpiredRecoveryEntries(input.now);

  return {
    stagedAssetCleanup,
    staleSigningCleanup,
    recoveryPurge,
  };
}
