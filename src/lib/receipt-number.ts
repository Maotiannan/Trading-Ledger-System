import type { DbTransactionClient } from '@/lib/transaction';
import { createApiError } from '@/lib/api-error';

export const RECEIPT_COUNTER_KEY = 'RECEIPT_NO';
export const RECEIPT_COUNTER_START = 1000;
const MAX_ALLOCATION_ATTEMPTS = 100;

export function formatReceiptNo(counter: number): string {
  return String(counter).padStart(7, '0');
}

function parseReceiptCounter(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const counter = Number(normalized);
  return Number.isSafeInteger(counter) && counter > 0 ? counter : null;
}

function normalizeRequestedReceiptNo(value: unknown): { receiptNo: string; counter: number } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const counter = parseReceiptCounter(value);
  if (counter === null) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '收据号只能填写数字',
      detail: { receiptNo: value },
    });
  }
  return { receiptNo: formatReceiptNo(counter), counter };
}

async function bumpCounterPast(tx: DbTransactionClient, nextCounter: number) {
  const current = await tx.systemCounter.findUnique({
    where: { key: RECEIPT_COUNTER_KEY },
    select: { nextValue: true },
  });
  const nextValue = Math.max(current?.nextValue ?? RECEIPT_COUNTER_START, nextCounter);
  await tx.systemCounter.upsert({
    where: { key: RECEIPT_COUNTER_KEY },
    create: {
      key: RECEIPT_COUNTER_KEY,
      nextValue,
    },
    update: {
      nextValue,
    },
  });
}

async function receiptNoExists(tx: DbTransactionClient, receiptNo: string): Promise<boolean> {
  const existing = await tx.receipt.findFirst({
    where: { receiptNo },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function getSuggestedNextReceiptNo(tx: Pick<DbTransactionClient, 'receipt'>): Promise<string> {
  const latestReceipts = await tx.receipt.findMany({
    where: { receiptNo: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { receiptNo: true },
  });
  const counters = latestReceipts
    .map((row) => parseReceiptCounter(row.receiptNo))
    .filter((value): value is number => value !== null);
  const largest = counters.length > 0 ? Math.max(...counters) : RECEIPT_COUNTER_START - 1;
  return formatReceiptNo(largest + 1);
}

export async function allocateNextReceiptNo(
  tx: DbTransactionClient,
  options: { requestedReceiptNo?: string | null } = {},
): Promise<string> {
  const requested = normalizeRequestedReceiptNo(options.requestedReceiptNo);
  if (requested) {
    if (await receiptNoExists(tx, requested.receiptNo)) {
      throw createApiError({
        code: 'CONFLICT',
        status: 409,
        message: `收据号 ${requested.receiptNo} 已存在，请换一个编号`,
        detail: { receiptNo: requested.receiptNo },
      });
    }
    await bumpCounterPast(tx, requested.counter + 1);
    return requested.receiptNo;
  }

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

  let receiptNo = formatReceiptNo(counter.nextValue - 1);
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    if (!(await receiptNoExists(tx, receiptNo))) {
      return receiptNo;
    }
    const suggestedReceiptNo = await getSuggestedNextReceiptNo(tx);
    const suggestedCounter = parseReceiptCounter(suggestedReceiptNo) ?? RECEIPT_COUNTER_START;
    await bumpCounterPast(tx, suggestedCounter + 1);
    receiptNo = formatReceiptNo(suggestedCounter);
  }

  throw createApiError({
    code: 'CONFLICT',
    status: 409,
    message: '收据号自动分配失败，请手动输入新的收据号',
  });
}
