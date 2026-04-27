import type { DbTransactionClient } from '@/lib/transaction';

export const RECEIPT_COUNTER_KEY = 'RECEIPT_NO';
export const RECEIPT_COUNTER_START = 1000;

export function formatReceiptNo(counter: number): string {
  return String(counter).padStart(7, '0');
}

export async function allocateNextReceiptNo(tx: DbTransactionClient): Promise<string> {
  const counter = await tx.systemCounter.upsert({
    where: { key: RECEIPT_COUNTER_KEY },
    create: {
      key: RECEIPT_COUNTER_KEY,
      nextValue: RECEIPT_COUNTER_START + 1,
    },
    update: {
      nextValue: { increment: 1 },
    },
  });

  return formatReceiptNo(counter.nextValue - 1);
}
