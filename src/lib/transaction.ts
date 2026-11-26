import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { guardFinancialWrites } from '@/lib/order-balance-lock';

export type DbTransactionClient = Prisma.TransactionClient;

export async function runInTransaction<T>(
  callback: (tx: DbTransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }
): Promise<T> {
  return db.$transaction(async (tx) => callback(tx), options);
}

export async function runFinancialTransaction<T>(callback: (tx: DbTransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runInTransaction(async (tx) => {
        // One short lock serializes funding and existing receipt writers. The
        // deployed migration installs this row; no network calls occur inside it.
        if (tx.prepaymentMutex) await tx.$queryRaw`SELECT id FROM PrepaymentMutex WHERE id = 'ledger' FOR UPDATE`;
        return callback(guardFinancialWrites(tx));
      }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000, ...options });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
}
