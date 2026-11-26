import type { DbTransactionClient } from '@/lib/transaction';

// Only the validated V2 accounting transaction may change allocated receivables.
const authorized = new WeakSet<object>();
export function authorizeAllocationWrite(tx: DbTransactionClient) { authorized.add(tx); }
export function isAllocationWriteAuthorized(tx: DbTransactionClient) { return authorized.has(tx); }
