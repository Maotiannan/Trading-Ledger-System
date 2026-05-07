import type { ReceiptOcrResult } from '@/lib/types';

function pickFirstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickFirstAmount(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.replace(/[,$\s]/g, '');
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

const INVOICE_NO_PATTERN = /\bL\d{2}MH[A-Z0-9]*\b/i;
const INVOICE_NO_GLOBAL_PATTERN = /\bL\d{2}MH[A-Z0-9]*\b/gi;

function normalizeExtractedOrderNo(value: string): string {
  return value
    .replace(/\s*-\s*/g, '-')
    .replace(/[,$#.;:]+$/g, '')
    .trim();
}

function normalizeExtractedInvNo(value: string): string {
  return value.replace(/[,$#.;:]+$/g, '').trim().toUpperCase();
}

function stripInvoiceNoTokens(text: string): string {
  return text.replace(INVOICE_NO_GLOBAL_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

function extractInvNoFromText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const match = value.match(INVOICE_NO_PATTERN);
    if (match?.[0]) return normalizeExtractedInvNo(match[0]);
  }
  return null;
}

function extractOrderNoFromText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;
    const strippedText = stripInvoiceNoTokens(text);
    const candidates = strippedText && strippedText !== text ? [strippedText, text] : [text];

    for (const candidate of candidates) {
      const afterForMatch = candidate.match(/(?:payment\s+for|paiement\s+pour|for)\s+([A-Za-z][A-Za-z0-9_ ./-]*-\s*[A-Za-z0-9_][A-Za-z0-9_./-]*)/i);
      if (afterForMatch?.[1]) {
        return normalizeExtractedOrderNo(afterForMatch[1]);
      }

      const looseMatch = candidate.match(/([A-Za-z][A-Za-z0-9_ ./]*-\s*[A-Za-z0-9_][A-Za-z0-9_./-]*)/);
      if (looseMatch?.[1]) {
        return normalizeExtractedOrderNo(looseMatch[1]);
      }
    }
  }
  return null;
}

export function normalizeReceiptOcrResult(value: Record<string, unknown>): ReceiptOcrResult {
  const textKeys = ['motif', 'memo', 'description', 'notes'];
  const orderNo = pickFirstString(value, ['orderNo', 'order_no', 'orderNumber', 'order_number', 'order'])
    ?? extractOrderNoFromText(value, textKeys);
  const invNo = pickFirstString(value, ['invNo', 'inv_no', 'invoiceNo', 'invoice_no', 'invoice'])
    ?? extractInvNoFromText(value, textKeys);

  return {
    receiptNo: pickFirstString(value, ['receiptNo', 'receipt_no', 'receiptNumber', 'receipt_number', 'no']),
    date: pickFirstString(value, ['date', 'paymentDate', 'payment_date']),
    tel: pickFirstString(value, ['tel', 'phone', 'clientTel', 'client_tel', 'telephone']),
    usd: pickFirstAmount(value, ['usd', 'amount', 'usdAmount', 'usd_amount', 'paymentAmount', 'payment_amount']),
    invNo,
    orderNo,
    payer: pickFirstString(value, ['payer', 'clientName', 'client_name', 'customerName', 'customer_name', 'payor']),
    // Upload Receipt defaults to non-deposit; users must explicitly check DEPOSIT.
    isDeposit: false,
  };
}
