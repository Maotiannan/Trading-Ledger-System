import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { runInTransaction } from '@/lib/transaction';
import { calculateSwiftTransferSummary } from '@/lib/swift-transfer-summary';
import { getSwiftFeePerCopy, lockSwiftDetail, syncSwiftTransferState } from '@/lib/swift-transfer-service';

// Only correct the old partial-transfer state; completed/error/manual flows stay intact.
export async function reconcilePartialSwiftStatuses(options: { apply?: boolean; actorId?: string } = {}) {
  if (options.apply) {
    const actor = options.actorId ? await db.user.findUnique({ where: { id: options.actorId }, select: { role: true } }) : null;
    if (actor?.role !== UserRole.ADMIN) {
      throw createApiError({ code: 'FORBIDDEN', status: 403, message: 'ADMIN actor is required for SWIFT status reconciliation' });
    }
  }
  const fee = await getSwiftFeePerCopy();
  const rows = await db.detail.findMany({
    where: { status: 'Bank_Transfer', swifts: { some: {} } },
    include: { swifts: true },
    orderBy: { id: 'asc' },
  });
  const candidates = rows.filter((row) => {
    const summary = calculateSwiftTransferSummary(row.totalAmount, row.swifts, fee);
    return summary.validSwiftCount > 0 && summary.status === 'Waiting_SWIFT';
  });
  const changed: string[] = [];
  for (const candidate of options.apply ? candidates : []) {
    const applied = await runInTransaction(async (tx) => {
      await lockSwiftDetail(tx, candidate.id);
      const current = await tx.detail.findUnique({ where: { id: candidate.id }, include: {
        swifts: true, items: { include: { receipt: { select: { id: true, status: true } } } },
      } });
      if (!current || current.status !== 'Bank_Transfer') return false;
      const beforeSummary = calculateSwiftTransferSummary(current.totalAmount, current.swifts, fee);
      if (beforeSummary.validSwiftCount === 0 || beforeSummary.status !== 'Waiting_SWIFT') return false;
      const receiptsBefore = current.items.flatMap((item) => item.receipt ? [item.receipt] : []);
      const summary = await syncSwiftTransferState(tx, current.id, fee);
      await recordAuditEventInTransaction(tx, {
        action: 'SWIFT_PARTIAL_STATUS_RECONCILE', actorId: options.actorId!, targetType: 'DETAIL', targetId: current.id,
        metadata: { source: 'partial-swift-status-fix', before: current.status, after: summary.status, receiptsBefore, summary },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (applied) changed.push(candidate.id);
  }
  return { mode: options.apply ? 'apply' : 'dry-run', candidates: candidates.map((row) => row.id), changed };
}
