'use client';

import type { CustomerOrderHistory } from '@/components/workspace/modules/customers/components/customer-order-history-dialog';
import type { DashboardCustomerOutstanding } from '@/lib/dashboard-customer-outstanding';

const CUSTOMER_HISTORY_CACHE_TTL_MS = 30_000;

export type CachedCustomerHistory = CustomerOrderHistory & {
  orderNames?: string[];
  outstanding?: DashboardCustomerOutstanding | null;
};

type CacheEntry = {
  value: CachedCustomerHistory;
  storedAt: number;
};

const cache = new Map<string, CacheEntry>();

export function makeCustomerHistoryCacheKey(input: {
  userId: string;
  customerId: string;
  orderPage: number;
  orderPageSize: number;
  receiptPage: number;
  receiptPageSize: number;
}): string {
  return [
    input.userId,
    input.customerId,
    input.orderPage,
    input.orderPageSize,
    input.receiptPage,
    input.receiptPageSize,
  ].join(':');
}

export function readCustomerHistoryCache(key: string): { value: CachedCustomerHistory; fresh: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  return {
    value: entry.value,
    fresh: Date.now() - entry.storedAt <= CUSTOMER_HISTORY_CACHE_TTL_MS,
  };
}

export function rememberCustomerHistory(key: string, value: CachedCustomerHistory): void {
  cache.set(key, { value, storedAt: Date.now() });
}

export function clearCustomerHistoryCache(): void {
  cache.clear();
}
