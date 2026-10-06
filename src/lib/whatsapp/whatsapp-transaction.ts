import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

// Retry the complete transaction with a fresh snapshot after concurrent creation
// or a deadlock. Provider requests must never run inside this callback.
export async function runWhatsAppTransaction<T>(callback: (tx: DbTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await runInTransaction(callback, { isolationLevel: 'Serializable' }); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      // MariaDB reports this serialization conflict without Prisma's P2034 code.
      const changedRecord = error instanceof Error && /MysqlError \{ code: 1020,/.test(error.message)
        && error.message.includes('Record has changed since last read');
      if (attempt >= 2 || (code !== 'P2002' && code !== 'P2034' && !changedRecord)) throw error;
    }
  }
}
