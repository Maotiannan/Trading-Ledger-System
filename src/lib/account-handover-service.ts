import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { managedOwnershipWhere } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { executeMutationIntent } from '@/lib/mutation-intent';
import { recordAuditEventInTransaction } from '@/lib/audit';

const models = ['invoice', 'order', 'receipt', 'detail', 'swift', 'orderTracker', 'paymentAgent', 'uploadedAsset'] as const;
type Rows = Array<{ id: string; updatedAt: Date }>;
type CustodyDelegate = {
  findMany(args: unknown): Promise<Rows>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

async function targets(user: CurrentUser, sourceId: string, recipientId: string, client: DbTransactionClient | typeof db = db) {
  if (!['ADMIN', 'SALES'].includes(user.role)) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限交接业务' });
  const scope = await getHierarchyScope(user, client);
  const [source, recipient] = await Promise.all([client.user.findUnique({ where: { id: sourceId } }), client.user.findUnique({ where: { id: recipientId } })]);
  const rank = { USER: 1, SALES: 2, ADMIN: 3 };
  if (!source || !recipient || sourceId === recipientId || sourceId === user.id || !scope.descendantIds.has(sourceId)
    || !scope.ownerVisibleIds.has(recipientId) || recipient.disabledAt || rank[recipient.role] < rank[source.role]) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '交接账户无效、超出管理范围或接收人权限不足' });
  }
  return { source, recipient };
}

async function inventory(tx: DbTransactionClient | typeof db, sourceId: string) {
  const resources: Record<string, Rows> = {};
  for (const model of models) {
    resources[model] = await (tx[model] as unknown as CustodyDelegate).findMany({ where: managedOwnershipWhere([sourceId]),
      select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } });
  }
  resources.customer = await tx.customer.findMany({ where: { ownerId: sourceId }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } });
  const fingerprint = createHash('sha256').update(JSON.stringify(resources)).digest('hex');
  return { resources, fingerprint, counts: Object.fromEntries(Object.entries(resources).map(([key, rows]) => [key, rows.length])) };
}

export async function previewAccountHandover(user: CurrentUser, sourceId: string, recipientId: string) {
  await targets(user, sourceId, recipientId);
  const result = await inventory(db, sourceId);
  return { fingerprint: result.fingerprint, counts: result.counts };
}

export async function confirmAccountHandover(user: CurrentUser, input: { sourceId: string; recipientId: string; fingerprint: string; requestId: string }) {
  await targets(user, input.sourceId, input.recipientId);
  return runInTransaction(async (tx) => executeMutationIntent(tx, {
    actorId: user.id, kind: 'account-handover', requestId: input.requestId, payload: input,
  }, async () => {
    for (const id of [input.sourceId, input.recipientId].sort()) await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
    await targets(user, input.sourceId, input.recipientId, tx);
    const before = await inventory(tx, input.sourceId);
    if (before.fingerprint !== input.fingerprint) throw createApiError({ code: 'CONFLICT', status: 409, message: '交接范围已变化，请重新预览' });
    for (const model of models) for (const row of before.resources[model]) {
      const changed = await (tx[model] as unknown as CustodyDelegate).updateMany({
        where: { id: row.id, updatedAt: row.updatedAt, ...managedOwnershipWhere([input.sourceId]) }, data: { managedById: input.recipientId },
      });
      if (changed.count !== 1) throw createApiError({ code: 'CONFLICT', status: 409, message: '交接范围已变化，请重新预览' });
    }
    for (const row of before.resources.customer) {
      const changed = await tx.customer.updateMany({ where: { id: row.id, updatedAt: row.updatedAt, ownerId: input.sourceId }, data: { ownerId: input.recipientId } });
      if (changed.count !== 1) throw createApiError({ code: 'CONFLICT', status: 409, message: '客户归属已变化，请重新预览' });
    }
    await recordAuditEventInTransaction(tx, { action: 'user.business_handover', actorId: user.id, targetType: 'USER', targetId: input.sourceId,
      metadata: { sourceId: input.sourceId, recipientId: input.recipientId, counts: before.counts, resources: before.resources, originalAuthorsUnchanged: true } });
    return { counts: before.counts, sourceId: input.sourceId, recipientId: input.recipientId };
  }), { isolationLevel: 'ReadCommitted' });
}

export async function reactivateManagedUser(user: CurrentUser, userId: string) {
  if (!['ADMIN', 'SALES'].includes(user.role)) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  const scope = await getHierarchyScope(user);
  const target = await db.user.findUnique({ where: { id: userId }, select: { level: true } });
  if (!scope.descendantIds.has(userId) || !target || target.level <= user.level) throw createApiError({ code: 'FORBIDDEN', status: 403, message: '只能管理下级账号' });
  await runInTransaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { disabledAt: null, sessionVersion: { increment: 1 } } });
    await recordAuditEventInTransaction(tx, { action: 'user.reactivated', actorId: user.id, targetType: 'USER', targetId: userId });
  });
  return { message: '账号已启用，请重新登录' };
}
