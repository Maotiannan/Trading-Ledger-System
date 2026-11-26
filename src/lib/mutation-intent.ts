import { createHash } from 'crypto';
import { createApiError } from '@/lib/api-error';
import type { DbTransactionClient } from '@/lib/transaction';
import type { Prisma } from '@prisma/client';

export async function executeMutationIntent<T extends Prisma.InputJsonObject>(
  tx: DbTransactionClient,
  input: { actorId: string; kind: string; requestId: string; payload: unknown },
  execute: () => Promise<T>,
): Promise<T> {
  if (!input.requestId || input.requestId.length > 128) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '缺少有效的操作标识，请重新打开窗口后重试' });
  }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const id = hash(JSON.stringify([input.actorId, input.kind, input.requestId]));
  const fingerprint = hash(JSON.stringify(input.payload));
  // Prisma may emulate upsert with SELECT/INSERT. Native MySQL upsert also locks
  // this intent until commit, so concurrent first attempts cannot both execute.
  await tx.$executeRaw`INSERT INTO MutationIntent (id, actorId, kind, fingerprint, result, completed, createdAt)
    VALUES (${id}, ${input.actorId}, ${input.kind}, ${fingerprint}, ${'{}'}, false, NOW(3))
    ON DUPLICATE KEY UPDATE id = id`;
  const existing = await tx.mutationIntent.findUniqueOrThrow({ where: { id } });
  if (existing.fingerprint !== fingerprint) {
    throw createApiError({ code: 'CONFLICT', status: 409, message: '操作内容已变化，请重新打开窗口' });
  }
  if (existing.completed) return existing.result as T;
  const result = await execute();
  await tx.mutationIntent.update({ where: { id }, data: { result, completed: true } });
  return result;
}
