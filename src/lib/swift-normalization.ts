export type SwiftOcrLike = {
  amount?: unknown;
  date?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  receiverName?: string | null;
  receiverAccount?: string | null;
};

export type NormalizedSwiftOcrResult = {
  amount: number | null;
  date: string | null;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
};

export function normalizeSwiftReceiverAccount(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[oO]/g, '0')
    .replace(/\s+/g, '')
    .replace(/\D+/g, '');
  return normalized || null;
}

export function normalizeSwiftAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/[,\s]/g, '')
    .replace(/[oO]/g, '0')
    .replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSwiftText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeSwiftOcrResult(result: SwiftOcrLike): NormalizedSwiftOcrResult {
  return {
    amount: normalizeSwiftAmount(result.amount),
    date: normalizeSwiftText(result.date),
    senderName: normalizeSwiftText(result.senderName),
    senderAddress: normalizeSwiftText(result.senderAddress),
    receiverName: normalizeSwiftText(result.receiverName),
    receiverAccount: normalizeSwiftReceiverAccount(result.receiverAccount),
  };
}
