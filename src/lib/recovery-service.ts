import { Prisma } from '@prisma/client';
import { stat, rm } from 'fs/promises';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { recordAuditEventInTransaction } from '@/lib/audit';
import type { CurrentUser } from '@/lib/request-auth';
import { runFinancialTransaction, type DbTransactionClient } from '@/lib/transaction';
import { resolveUploadedAssetAbsolutePath } from '@/lib/uploaded-asset-service';
import { getNumericSystemSetting, getUploadedAssetCleanupSettings } from '@/lib/system-settings';
import { logger } from '@/lib/logger';
import { getHierarchyScope } from '@/lib/user-hierarchy';

export function recoveryDeadline(now: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1 || days > 15) throw new Error('Recovery retention must be 1–15 days');
  return new Date(now.getTime() + days * 86_400_000);
}

export async function archiveForRecovery(tx: DbTransactionClient, input: {
  kind: 'STAGED_ASSET' | 'SIGNING_RECEIPT'; resourceId: string; ownerId: string; snapshot: unknown; files: string[]; now: Date;
}) {
  const configured = await getNumericSystemSetting('RECOVERY_RETENTION_DAYS', 15, { min: 1 });
  const entry = await tx.recoveryEntry.create({ data: {
    kind: input.kind, resourceId: input.resourceId, ownerId: input.ownerId, snapshot: JSON.parse(JSON.stringify(input.snapshot)),
    files: [...new Set(input.files)], deletedAt: input.now,
    recoverableUntil: recoveryDeadline(input.now, Math.min(15, Math.max(1, Math.floor(configured)))),
  } });
  await recordAuditEventInTransaction(tx, { action: 'recovery.archived', actorId: input.ownerId,
    targetType: 'RECOVERY', targetId: entry.id, metadata: { kind: input.kind, resourceId: input.resourceId,
      deletedAt: input.now.toISOString(), recoverableUntil: entry.recoverableUntil.toISOString() } });
  return entry;
}

function requireAdmin(user: CurrentUser) {
  if (user.role !== 'ADMIN') throw createApiError({ code: 'FORBIDDEN', status: 403, message: '仅管理员可以访问恢复区' });
}

export async function listRecoveryEntries(user: CurrentUser, now = new Date()) {
  requireAdmin(user);
  const scope = await getHierarchyScope(user);
  return db.recoveryEntry.findMany({ where: { ownerId: { in: [...scope.ownerVisibleIds] }, status: 'RECOVERABLE', recoverableUntil: { gt: now } },
    select: { id: true, kind: true, resourceId: true, deletedAt: true, recoverableUntil: true, lastError: true },
    orderBy: { deletedAt: 'desc' }, take: 200 });
}

export async function restoreRecoveryEntry(user: CurrentUser, id: string, now = new Date()) {
  requireAdmin(user);
  return runFinancialTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM RecoveryEntry WHERE id = ${id} FOR UPDATE`;
    const entry = await tx.recoveryEntry.findUnique({ where: { id } });
    if (!entry) throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '恢复记录不存在' });
    const scope = await getHierarchyScope(user, tx);
    if (!scope.ownerVisibleIds.has(entry.ownerId)) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权恢复此记录' });
    if (entry.status === 'RESTORED') return { restored: true, alreadyRestored: true };
    if (entry.status !== 'RECOVERABLE' || entry.recoverableUntil <= now) {
      throw createApiError({ code: 'CONFLICT', status: 409, message: '恢复期限已过或记录正在清理' });
    }
    for (const file of entry.files as string[]) {
      const info = await stat(resolveUploadedAssetAbsolutePath(file)).catch(() => null);
      if (!info?.isFile()) throw createApiError({ code: 'CONFLICT', status: 409, message: '恢复文件缺失，无法恢复', detail: { id } });
    }
    const snapshot = entry.snapshot as Record<string, Prisma.InputJsonValue>;
    if (entry.kind === 'STAGED_ASSET') {
      const original = snapshot.asset as Record<string, Prisma.InputJsonValue>;
      const { stagedTtlHours } = await getUploadedAssetCleanupSettings();
      const claim = await tx.uploadedAsset.updateMany({ where: { id: entry.resourceId, status: 'DELETED', deletedAt: entry.deletedAt },
        data: { status: 'STAGED', deletedAt: null, expiresAt: new Date(now.getTime() + stagedTtlHours * 3_600_000) } });
      if (claim.count !== 1 || !original) throw createApiError({ code: 'CONFLICT', status: 409, message: '附件当前关联已变化，无法恢复' });
    } else if (entry.kind === 'SIGNING_RECEIPT') {
      const receipt = snapshot.receipt as unknown as Prisma.ReceiptUncheckedCreateInput;
      const session = snapshot.session as unknown as Prisma.ReceiptGeneratorSessionUncheckedCreateInput;
      if (!receipt || !session) throw new Error('Invalid recovery snapshot');
      if (receipt.orderId && !await tx.order.findUnique({ where: { id: receipt.orderId } })) {
        throw createApiError({ code: 'CONFLICT', status: 409, message: '原订单已不存在，无法恢复原关联' });
      }
      await tx.receipt.create({ data: receipt });
      const histories = (snapshot.histories || []) as unknown as Prisma.ReceiptHistoryCreateManyInput[];
      const editRequests = (snapshot.editRequests || []) as unknown as Prisma.ReceiptEditRequestCreateManyInput[];
      if (histories.length) await tx.receiptHistory.createMany({ data: histories });
      if (editRequests.length) await tx.receiptEditRequest.createMany({ data: editRequests });
      await tx.receiptGeneratorSession.create({ data: { ...session,
        layoutSnapshot: session.layoutSnapshot === null ? Prisma.JsonNull : session.layoutSnapshot,
        createdAt: now, updatedAt: now } });
    } else throw new Error('Unknown recovery kind');
    await tx.recoveryEntry.update({ where: { id }, data: { status: 'RESTORED', restoredAt: now } });
    await recordAuditEventInTransaction(tx, { action: 'recovery.restored', actorId: user.id, targetType: 'RECOVERY', targetId: id,
      metadata: { kind: entry.kind, resourceId: entry.resourceId, deletedAt: entry.deletedAt.toISOString() } });
    return { restored: true, alreadyRestored: false };
  });
}

export async function purgeExpiredRecoveryEntries(now = new Date()) {
  const entries = await db.recoveryEntry.findMany({ where: { status: { in: ['RECOVERABLE', 'PURGING'] }, recoverableUntil: { lte: now } }, take: 100 });
  let purged = 0;
  for (const entry of entries) {
    try {
      const didPurge = await runFinancialTransaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM RecoveryEntry WHERE id = ${entry.id} FOR UPDATE`;
        const current = await tx.recoveryEntry.findUnique({ where: { id: entry.id } });
        if (!current || !['RECOVERABLE', 'PURGING'].includes(current.status) || current.recoverableUntil > now) return;
        await tx.recoveryEntry.update({ where: { id: entry.id }, data: { status: 'PURGING' } });
        for (const file of current.files as string[]) {
          const used = await tx.uploadedAsset.count({ where: { path: file, status: { in: ['STAGED', 'ATTACHED'] } } })
            + await tx.receipt.count({ where: { imageUrl: file } })
            + await tx.detail.count({ where: { imageUrl: file } })
            + await tx.swift.count({ where: { imageUrl: file } })
            + await tx.paymentAgentFile.count({ where: { path: file } })
            + await tx.receiptGeneratorSession.count({ where: { OR: [{ finalImageUrl: file }, { payerSignatureUrl: file }, { receiverSignatureUrl: file }] } });
          if (used) throw new Error('Recovery file is referenced by active business data');
          await rm(resolveUploadedAssetAbsolutePath(file), { force: true });
        }
        await tx.recoveryEntry.update({ where: { id: entry.id }, data: { status: 'PURGED', purgedAt: now, lastError: null, snapshot: {} } });
        return true;
      });
      if (didPurge) purged += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.recoveryEntry.update({ where: { id: entry.id }, data: { lastError: message } });
      logger.error('Recovery purge failed; deadline unchanged', { recoveryId: entry.id, message });
    }
  }
  return { purged };
}
