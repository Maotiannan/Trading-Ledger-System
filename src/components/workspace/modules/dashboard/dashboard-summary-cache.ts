'use client';

const DASHBOARD_SUMMARY_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T;
  storedAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function readDashboardSummaryCache<T>(userId: string): { value: T; fresh: boolean } | null {
  const entry = cache.get(userId) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return {
    value: entry.value,
    fresh: Date.now() - entry.storedAt <= DASHBOARD_SUMMARY_CACHE_TTL_MS,
  };
}

export function rememberDashboardSummary<T>(userId: string, value: T): void {
  cache.set(userId, { value, storedAt: Date.now() });
}

export function clearDashboardSummaryCache(): void {
  cache.clear();
}
