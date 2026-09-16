import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

// Retry the complete transaction with a fresh snapshot after concurrent creation
// or a deadlock. Provider requests must never run inside this callback.
export async function runWhatsAppTransaction<T>(callback: (tx: DbTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await runInTransaction(callback); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (attempt >= 2 || (code !== 'P2002' && code !== 'P2034')) throw error;
    }
  }
}
