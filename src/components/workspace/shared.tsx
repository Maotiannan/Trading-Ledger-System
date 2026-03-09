'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intl';
import { translateApiErrorMessage } from '@/i18n/workspace/api-error-map';
import { deriveOrderGroupKey } from '@/lib/order-group';

export async function apiCall(endpoint: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(`/api/${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const locale =
      typeof document !== 'undefined' && document.documentElement.lang
        ? document.documentElement.lang
        : 'zh';
    const message =
      typeof json?.error === 'string' ? json.error : `HTTP ${response.status}`;
    throw new Error(locale.startsWith('en') ? translateApiErrorMessage(message) : message);
  }

  return normalizeNumericPayload(json);
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const DECIMAL_KEYS = new Set([
  'amount',
  'orderBalance',
  'usd',
  'totalAmount',
  'invAmount',
  'invBalance',
  'credit',
]);

export function normalizeNumericPayload<T>(input: T): T {
  const visit = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = visit(v, k);
      }
      return out;
    }
    if (typeof value === 'string' && key && DECIMAL_KEYS.has(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return value;
  };
  return visit(input) as T;
}

export function getDisplayImageUrl(rawUrl: string): string {
  if (rawUrl.startsWith('/upload/images/')) {
    return `/api/upload-image?path=${encodeURIComponent(rawUrl)}`;
  }
  return rawUrl;
}

export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function summarizeRowsForAlert(rows: unknown, limit = 20): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const list = rows
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (list.length === 0) return '';
  const shown = list.slice(0, limit);
  const suffix = list.length > limit ? `\n... (+${list.length - limit})` : '';
  return `\n${shown.join('\n')}${suffix}`;
}

export const IMPORT_RESULT_PAGE_SIZE = 50;

export type InvoiceImportIssueRow = {
  rowNo: number;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orderNo: string;
  amount: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  reason: string;
};

export type InvoiceImportRowResult = Omit<InvoiceImportIssueRow, 'reason'> & {
  status: 'SUCCESS' | 'FAILED';
  reason: string;
};

export type InvoiceImportRowView = Omit<InvoiceImportIssueRow, 'reason'> & {
  latestStatus: 'SUCCESS' | 'FAILED';
  latestReason: string;
  attempts: Array<{ status: string; reason: string }>;
};

export function toInvoiceImportRowResults(raw: unknown): InvoiceImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      invNo: String(item.invNo || ''),
      shipDate: String(item.shipDate || ''),
      releaseDate: String(item.releaseDate || ''),
      orderNo: String(item.orderNo || ''),
      amount: String(item.amount || ''),
      customerMark: String(item.customerMark || ''),
      customerName: String(item.customerName || ''),
      customerId: String(item.customerId || ''),
      status: String(item.status || '').toUpperCase() === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function toInvoiceImportRowResultsFromIssues(raw: unknown): InvoiceImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      invNo: String(item.invNo || ''),
      shipDate: String(item.shipDate || ''),
      releaseDate: String(item.releaseDate || ''),
      orderNo: String(item.orderNo || ''),
      amount: String(item.amount || ''),
      customerMark: String(item.customerMark || ''),
      customerName: String(item.customerName || ''),
      customerId: String(item.customerId || ''),
      status: 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function initInvoiceImportRowViews(results: InvoiceImportRowResult[]): InvoiceImportRowView[] {
  return results
    .sort((a, b) => a.rowNo - b.rowNo)
    .map((row) => ({
      rowNo: row.rowNo,
      invNo: row.invNo,
      shipDate: row.shipDate,
      releaseDate: row.releaseDate,
      orderNo: row.orderNo,
      amount: row.amount,
      customerMark: row.customerMark,
      customerName: row.customerName,
      customerId: row.customerId,
      latestStatus: row.status,
      latestReason: row.reason,
      attempts: [{ status: row.status, reason: row.reason }],
    }));
}

export function mergeInvoiceImportRowViews(
  prev: InvoiceImportRowView[],
  retryResults: InvoiceImportRowResult[]
): InvoiceImportRowView[] {
  const byRowNo = new Map<number, InvoiceImportRowResult>();
  for (const row of retryResults) byRowNo.set(row.rowNo, row);

  const merged = prev.map((row) => {
    const next = byRowNo.get(row.rowNo);
    if (next) {
      return {
        rowNo: next.rowNo,
        invNo: next.invNo,
        shipDate: next.shipDate,
        releaseDate: next.releaseDate,
        orderNo: next.orderNo,
        amount: next.amount,
        customerMark: next.customerMark,
        customerName: next.customerName,
        customerId: next.customerId,
        latestStatus: next.status,
        latestReason: next.reason,
        attempts: [...row.attempts, { status: next.status, reason: next.reason }],
      };
    }
    const carryStatus = row.latestStatus === 'SUCCESS' ? 'SUCCEED' : 'NOT_RETRIED';
    return {
      ...row,
      attempts: [...row.attempts, { status: carryStatus, reason: row.latestReason }],
    };
  });

  const prevRowNos = new Set(prev.map((row) => row.rowNo));
  const attemptLength = merged[0]?.attempts.length || 1;
  for (const next of retryResults) {
    if (prevRowNos.has(next.rowNo)) continue;
    const fillerCount = Math.max(0, attemptLength - 1);
    merged.push({
      rowNo: next.rowNo,
      invNo: next.invNo,
      shipDate: next.shipDate,
      releaseDate: next.releaseDate,
      orderNo: next.orderNo,
      amount: next.amount,
      customerMark: next.customerMark,
      customerName: next.customerName,
      customerId: next.customerId,
      latestStatus: next.status,
      latestReason: next.reason,
      attempts: [
        ...Array.from({ length: fillerCount }, () => ({ status: 'SUCCEED', reason: '' })),
        { status: next.status, reason: next.reason },
      ],
    });
  }
  return merged.sort((a, b) => a.rowNo - b.rowNo);
}

export type CustomerImportIssueRow = {
  rowNo: number;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerEmail: string;
  reason: string;
};

export type CustomerImportRowResult = Omit<CustomerImportIssueRow, 'reason'> & {
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED';
  reason: string;
};

export type CustomerImportRowView = Omit<CustomerImportIssueRow, 'reason'> & {
  latestStatus: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED';
  latestReason: string;
  attempts: Array<{ status: string; reason: string }>;
};

export function toCustomerImportRowResults(raw: unknown): CustomerImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    const statusRaw = String(item.status || '').toUpperCase();
    const status = statusRaw === 'CREATED' || statusRaw === 'UPDATED' || statusRaw === 'UNCHANGED' || statusRaw === 'FAILED'
      ? statusRaw
      : 'FAILED';
    return {
      rowNo: Number(item.rowNo) || 0,
      mark: String(item.mark || ''),
      orderName: String(item.orderName || ''),
      name: String(item.name || ''),
      phone: String(item.phone || ''),
      city: String(item.city || ''),
      consignee: String(item.consignee || ''),
      companyName: String(item.companyName || ''),
      credit: String(item.credit || ''),
      companyAddress: String(item.companyAddress || ''),
      ownerEmail: String(item.ownerEmail || ''),
      status: status as CustomerImportRowResult['status'],
      reason: String(item.reason || ''),
    };
  });
}

export function toCustomerImportRowResultsFromIssues(raw: unknown): CustomerImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      mark: String(item.mark || ''),
      orderName: String(item.orderName || ''),
      name: String(item.name || ''),
      phone: String(item.phone || ''),
      city: String(item.city || ''),
      consignee: String(item.consignee || ''),
      companyName: String(item.companyName || ''),
      credit: String(item.credit || ''),
      companyAddress: String(item.companyAddress || ''),
      ownerEmail: String(item.ownerEmail || ''),
      status: 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function initCustomerImportRowViews(results: CustomerImportRowResult[]): CustomerImportRowView[] {
  return results
    .sort((a, b) => a.rowNo - b.rowNo)
    .map((row) => ({
      rowNo: row.rowNo,
      mark: row.mark,
      orderName: row.orderName,
      name: row.name,
      phone: row.phone,
      city: row.city,
      consignee: row.consignee,
      companyName: row.companyName,
      credit: row.credit,
      companyAddress: row.companyAddress,
      ownerEmail: row.ownerEmail,
      latestStatus: row.status,
      latestReason: row.reason,
      attempts: [{ status: row.status, reason: row.reason }],
    }));
}

export function mergeCustomerImportRowViews(
  prev: CustomerImportRowView[],
  retryResults: CustomerImportRowResult[]
): CustomerImportRowView[] {
  const byRowNo = new Map<number, CustomerImportRowResult>();
  for (const row of retryResults) byRowNo.set(row.rowNo, row);

  const merged = prev.map((row) => {
    const next = byRowNo.get(row.rowNo);
    if (next) {
      return {
        rowNo: next.rowNo,
        mark: next.mark,
        orderName: next.orderName,
        name: next.name,
        phone: next.phone,
        city: next.city,
        consignee: next.consignee,
        companyName: next.companyName,
        credit: next.credit,
        companyAddress: next.companyAddress,
        ownerEmail: next.ownerEmail,
        latestStatus: next.status,
        latestReason: next.reason,
        attempts: [...row.attempts, { status: next.status, reason: next.reason }],
      };
    }
    const carryStatus = row.latestStatus !== 'FAILED' ? 'SUCCEED' : 'NOT_RETRIED';
    return {
      ...row,
      attempts: [...row.attempts, { status: carryStatus, reason: row.latestReason }],
    };
  });

  const prevRowNos = new Set(prev.map((row) => row.rowNo));
  const attemptLength = merged[0]?.attempts.length || 1;
  for (const next of retryResults) {
    if (prevRowNos.has(next.rowNo)) continue;
    const fillerCount = Math.max(0, attemptLength - 1);
    merged.push({
      rowNo: next.rowNo,
      mark: next.mark,
      orderName: next.orderName,
      name: next.name,
      phone: next.phone,
      city: next.city,
      consignee: next.consignee,
      companyName: next.companyName,
      credit: next.credit,
      companyAddress: next.companyAddress,
      ownerEmail: next.ownerEmail,
      latestStatus: next.status,
      latestReason: next.reason,
      attempts: [
        ...Array.from({ length: fillerCount }, () => ({ status: 'SUCCEED', reason: '' })),
        { status: next.status, reason: next.reason },
      ],
    });
  }
  return merged.sort((a, b) => a.rowNo - b.rowNo);
}

export async function fetchServerDate(): Promise<string> {
  try {
    const result = await apiCall('system/health');
    const serverDate = typeof result?.data?.serverDate === 'string' ? result.data.serverDate : '';
    if (serverDate) return serverDate;
  } catch {
    // fallback to client date
  }
  return new Date().toISOString().slice(0, 10);
}

export async function lookupCustomerByOrderNoGroup(orderNoInput: string): Promise<{ mark: string; name: string; customerId: string } | null> {
  const normalized = orderNoInput.trim();
  if (!normalized) return null;
  const inputGroupKey = deriveOrderGroupKey(normalized);
  if (!inputGroupKey) return null;

  const result = await apiCall(`invoice?orderNo=${encodeURIComponent(normalized)}`);
  if (!result.success || !Array.isArray(result.data)) return null;

  const markMap = new Map<string, { mark: string; name: string; customerId: string }>();
  for (const row of result.data as Array<Record<string, unknown>>) {
    const rowOrderNo = String(row.orderNo || '');
    if (!rowOrderNo || deriveOrderGroupKey(rowOrderNo) !== inputGroupKey) continue;
    const mark = String(row.customerMark || '').trim();
    if (!mark) continue;
    const key = mark.toLowerCase();
    if (!markMap.has(key)) {
      markMap.set(key, {
        mark,
        name: String(row.customerName || ''),
        customerId: String(row.customerId || ''),
      });
    }
  }

  if (markMap.size === 1) {
    return Array.from(markMap.values())[0];
  }

  const byMark = await apiCall(`customer?mark=${encodeURIComponent(inputGroupKey)}`);
  if (byMark.success && Array.isArray(byMark.data) && byMark.data.length === 1) {
    const row = byMark.data[0] as Record<string, unknown>;
    return {
      mark: String(row.mark || ''),
      name: String(row.orderName || row.name || ''),
      customerId: String(row.id || ''),
    };
  }

  return null;
}

export function useUiText() {
  const locale = useLocale();
  return useCallback((zh: string, en: string) => (locale === 'en' ? en : zh), [locale]);
}

export type CustomerCandidate = {
  id: string;
  mark: string;
  orderName: string;
  displayName?: string;
  phone?: string | null;
  city?: string | null;
};

type CustomerMarkApiRow = {
  id: string;
  mark: string;
  orderName?: string;
  name?: string;
  phone?: string | null;
  city?: string | null;
};

const CUSTOMER_MARK_CACHE_TTL_MS = 10_000;
const customerMarkCache = new Map<string, { timestamp: number; data: CustomerMarkApiRow[] }>();
const customerMarkInflight = new Map<string, Promise<{ success: boolean; data: CustomerMarkApiRow[] }>>();

export async function fetchCustomerCandidatesByMark(mark: string): Promise<{ success: boolean; data: CustomerMarkApiRow[] }> {
  const normalized = mark.trim();
  if (!normalized) return { success: true, data: [] };

  const key = normalized.toLowerCase();
  const now = Date.now();
  const cached = customerMarkCache.get(key);
  if (cached && now - cached.timestamp <= CUSTOMER_MARK_CACHE_TTL_MS) {
    return { success: true, data: cached.data };
  }

  const inflight = customerMarkInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const result = await apiCall(`customer?mark=${encodeURIComponent(normalized)}`);
    if (!result.success || !Array.isArray(result.data)) {
      return { success: false, data: [] as CustomerMarkApiRow[] };
    }
    const rows = result.data as CustomerMarkApiRow[];
    customerMarkCache.set(key, { timestamp: Date.now(), data: rows });
    return { success: true, data: rows };
  })().finally(() => {
    customerMarkInflight.delete(key);
  });

  customerMarkInflight.set(key, promise);
  return promise;
}
