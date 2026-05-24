import type { DbTransactionClient } from '@/lib/transaction';
import { createApiError } from '@/lib/api-error';

export const RECEIPT_COUNTER_KEY = 'RECEIPT_NO';
export const RECEIPT_COUNTER_START = 10000;
const MAX_ALLOCATION_ATTEMPTS = 100;

export function formatReceiptNo(counter: number): string {
  return String(counter).padStart(6, '0');
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

export async function getSuggestedNextReceiptNo(tx: Pick<DbTransactionClient, 'receipt' | 'systemCounter'>): Promise<string> {
  const counter = await tx.systemCounter.findUnique({
    where: { key: RECEIPT_COUNTER_KEY },
    select: { nextValue: true },
  });
  let nextValue = Math.max(counter?.nextValue ?? RECEIPT_COUNTER_START, RECEIPT_COUNTER_START);

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const receiptNo = formatReceiptNo(nextValue);
    if (!(await receiptNoExists(tx as DbTransactionClient, receiptNo))) {
      return receiptNo;
    }
    nextValue += 1;
  }

  throw createApiError({
    code: 'CONFLICT',
    status: 409,
    message: '收据号自动分配失败，请稍后重试',
  });
}

async function reserveNextReceiptCounter(tx: DbTransactionClient): Promise<number> {
  const current = await tx.systemCounter.findUnique({
    where: { key: RECEIPT_COUNTER_KEY },
    select: { nextValue: true },
  });
  const shouldInitialize = !current || current.nextValue < RECEIPT_COUNTER_START;
  const counter = await tx.systemCounter.upsert({
    where: { key: RECEIPT_COUNTER_KEY },
    create: {
      key: RECEIPT_COUNTER_KEY,
      nextValue: RECEIPT_COUNTER_START + 1,
    },
    update: shouldInitialize
      ? { nextValue: RECEIPT_COUNTER_START + 1 }
      : { nextValue: { increment: 1 } },
  });
  return shouldInitialize ? RECEIPT_COUNTER_START : Math.max(counter.nextValue - 1, RECEIPT_COUNTER_START);
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

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const counterValue = await reserveNextReceiptCounter(tx);
    const receiptNo = formatReceiptNo(counterValue);
    if (!(await receiptNoExists(tx, receiptNo))) {
      return receiptNo;
    }
  }

  throw createApiError({
    code: 'CONFLICT',
    status: 409,
    message: '收据号自动分配失败，请手动输入新的收据号',
  });
}
