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

function normalizeExtractedOrderNo(value: string): string {
  return value
    .replace(/\s*-\s*/g, '-')
    .replace(/[,$#.;:]+$/g, '')
    .trim();
}

function extractOrderNoFromText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text) continue;

    const afterForMatch = text.match(/(?:payment\s+for|paiement\s+pour|for)\s+([A-Za-z][A-Za-z0-9_ ./-]*-\s*[A-Za-z0-9_][A-Za-z0-9_./-]*)/i);
    if (afterForMatch?.[1]) {
      return normalizeExtractedOrderNo(afterForMatch[1]);
    }

    const looseMatch = text.match(/([A-Za-z][A-Za-z0-9_ ./]*-\s*[A-Za-z0-9_][A-Za-z0-9_./-]*)/);
    if (looseMatch?.[1]) {
      return normalizeExtractedOrderNo(looseMatch[1]);
    }
  }
  return null;
}

export function normalizeReceiptOcrResult(value: Record<string, unknown>): ReceiptOcrResult {
  const orderNo = pickFirstString(value, ['orderNo', 'order_no', 'orderNumber', 'order_number', 'order'])
    ?? extractOrderNoFromText(value, ['motif', 'memo', 'description', 'notes']);

  return {
    receiptNo: pickFirstString(value, ['receiptNo', 'receipt_no', 'receiptNumber', 'receipt_number', 'no']),
    date: pickFirstString(value, ['date', 'paymentDate', 'payment_date']),
    tel: pickFirstString(value, ['tel', 'phone', 'clientTel', 'client_tel', 'telephone']),
    usd: pickFirstAmount(value, ['usd', 'amount', 'usdAmount', 'usd_amount', 'paymentAmount', 'payment_amount']),
    invNo: pickFirstString(value, ['invNo', 'inv_no', 'invoiceNo', 'invoice_no', 'invoice']),
    orderNo,
    payer: pickFirstString(value, ['payer', 'clientName', 'client_name', 'customerName', 'customer_name', 'payor']),
    // Upload Receipt defaults to non-deposit; users must explicitly check DEPOSIT.
    isDeposit: false,
  };
}
