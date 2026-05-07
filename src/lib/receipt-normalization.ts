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

function pickFirstBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', '1', 'deposit'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
  }
  return false;
}

export function normalizeReceiptOcrResult(value: Record<string, unknown>): ReceiptOcrResult {
  return {
    receiptNo: pickFirstString(value, ['receiptNo', 'receipt_no', 'receiptNumber', 'receipt_number', 'no']),
    date: pickFirstString(value, ['date', 'paymentDate', 'payment_date']),
    tel: pickFirstString(value, ['tel', 'phone', 'clientTel', 'client_tel', 'telephone']),
    usd: pickFirstAmount(value, ['usd', 'amount', 'usdAmount', 'usd_amount', 'paymentAmount', 'payment_amount']),
    invNo: pickFirstString(value, ['invNo', 'inv_no', 'invoiceNo', 'invoice_no', 'invoice']),
    orderNo: pickFirstString(value, ['orderNo', 'order_no', 'orderNumber', 'order_number', 'order']),
    payer: pickFirstString(value, ['payer', 'clientName', 'client_name', 'customerName', 'customer_name', 'payor']),
    isDeposit: pickFirstBoolean(value, ['isDeposit', 'is_deposit', 'deposit']),
  };
}
