'use client';

import { translateApiErrorCode, translateApiErrorMessage } from '@/i18n/workspace/api-error-map';
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

const API_PREFETCH_MAX_AGE_MS = 30_000;

type ApiPrefetchEntry = {
  value: unknown;
  storedAt: number;
};

const apiPrefetchCache = new Map<string, ApiPrefetchEntry>();
const apiPrefetchInflight = new Map<string, Promise<unknown>>();

type ApiErrorLike = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
  detail?: unknown;
};

export class WorkspaceApiError extends Error {
  readonly code?: string;
  readonly detail?: unknown;
  readonly status?: number;

  constructor(message: string, options: { code?: string; detail?: unknown; status?: number } = {}) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.code = options.code;
    this.detail = options.detail;
    this.status = options.status;
  }
}

function getCurrentLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return 'zh';
}

function normalizeEndpointKey(endpoint: string): string {
  return endpoint.replace(/^\/+/, '').replace(/^api\//, '');
}

function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) {
    const values = detail.map((item) => String(item || '').trim()).filter(Boolean);
    return values.join(', ');
  }
  if (detail && typeof detail === 'object') {
    try {
      return JSON.stringify(detail);
    } catch {
      return '';
    }
  }
  return '';
}

function extractApiErrorLike(input: unknown): { message: string; code?: string; detail?: unknown; status?: number } {
  if (input instanceof WorkspaceApiError) {
    return {
      message: input.message,
      code: input.code,
      detail: input.detail,
      status: input.status,
    };
  }

  if (input instanceof Error) {
    return { message: input.message };
  }

  if (input && typeof input === 'object') {
    const value = input as ApiErrorLike;
    const locale = getCurrentLocale();
    const rawMessage = typeof value.error === 'string'
      ? value.error
      : (typeof value.message === 'string' ? value.message : '');
    const code = typeof value.code === 'string' ? value.code : undefined;
    const message = rawMessage
      ? (locale.startsWith('en') ? translateApiErrorMessage(rawMessage) : rawMessage)
      : (locale.startsWith('en') ? translateApiErrorCode(code, '') : '');
    return {
      message,
      code,
      detail: value.detail,
    };
  }

  return { message: '' };
}

function toWorkspaceApiError(input: unknown, status?: number, fallback?: string): WorkspaceApiError {
  const locale = getCurrentLocale();
  const extracted = extractApiErrorLike(input);
  const fallbackMessage = fallback || `HTTP ${status || 500}`;
  const baseMessage = extracted.message || fallbackMessage;
  const translated = extracted.message
    ? baseMessage
    : (locale.startsWith('en') ? translateApiErrorCode(extracted.code, fallbackMessage) : baseMessage);
  return new WorkspaceApiError(translated, {
    code: extracted.code,
    detail: extracted.detail,
    status,
  });
}

async function parseApiResponse(response: Response) {
  const json = normalizeNumericPayload(await response.json().catch(() => ({})));
  if (!response.ok) {
    throw toWorkspaceApiError(json, response.status);
  }
  return json;
}

export function peekPrefetchedApiResult<T>(endpoint: string, maxAgeMs = API_PREFETCH_MAX_AGE_MS): T | null {
  const key = normalizeEndpointKey(endpoint);
  const cached = apiPrefetchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.storedAt > maxAgeMs) {
    apiPrefetchCache.delete(key);
    return null;
  }
  return cached.value as T;
}

export function rememberPrefetchedApiResult<T>(endpoint: string, result: T): T {
  const key = normalizeEndpointKey(endpoint);
  apiPrefetchCache.set(key, {
    value: result,
    storedAt: Date.now(),
  });
  return result;
}

export async function prefetchApiResult(endpoint: string, options: RequestInit = {}): Promise<unknown | null> {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') return null;

  const key = normalizeEndpointKey(endpoint);
  const cached = peekPrefetchedApiResult(key);
  if (cached) return cached;

  const inflight = apiPrefetchInflight.get(key);
  if (inflight) return inflight;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const promise = fetch(`/api/${key}`, {
    ...options,
    method,
    credentials: 'include',
    headers,
  })
    .then(parseApiResponse)
    .then((result) => rememberPrefetchedApiResult(key, result))
    .catch(() => null)
    .finally(() => {
      apiPrefetchInflight.delete(key);
    });

  apiPrefetchInflight.set(key, promise);
  return promise;
}

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

  return parseApiResponse(response);
}

export async function apiUploadCall(endpoint: string, formData: FormData, options: Omit<RequestInit, 'body' | 'headers'> = {}) {
  const response = await fetch(`/api/${endpoint}`, {
    ...options,
    body: formData,
    credentials: 'include',
  });

  return parseApiResponse(response);
}

export async function getApiResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const json = normalizeNumericPayload(await response.json().catch(() => ({})));
  return getApiErrorMessage(json, fallback);
}

export function getApiErrorCode(input: unknown): string | undefined {
  return extractApiErrorLike(input).code;
}

export function getApiErrorDetail(input: unknown): unknown {
  return extractApiErrorLike(input).detail;
}

export function isApiErrorCode(input: unknown, ...codes: string[]): boolean {
  const code = getApiErrorCode(input);
  return Boolean(code && codes.includes(code));
}

export function getApiErrorMessage(
  error: unknown,
  fallback: string,
  options: { appendDetail?: boolean } = {}
): string {
  const extracted = extractApiErrorLike(error);
  const message = extracted.message || fallback;
  if (!options.appendDetail) return message;
  const detailText = formatApiErrorDetail(extracted.detail);
  if (!detailText || detailText === message) return message;
  return `${message} | ${detailText}`;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return getApiErrorMessage(error, fallback);
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
