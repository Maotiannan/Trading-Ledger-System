import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

export type DbTransactionClient = Prisma.TransactionClient;

export async function runInTransaction<T>(
  callback: (tx: DbTransactionClient) => Promise<T>
): Promise<T> {
  return db.$transaction(async (tx) => callback(tx));
}
