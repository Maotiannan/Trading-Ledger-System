'use client';

import { translateApiErrorMessage } from '@/i18n/workspace/api-error-map';
import { deriveOrderGroupKey } from '@/lib/order-group';

const DECIMAL_KEYS = new Set([
  'amount',
  'orderBalance',
  'usd',
  'totalAmount',
  'invAmount',
  'invBalance',
  'credit',
]);

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
