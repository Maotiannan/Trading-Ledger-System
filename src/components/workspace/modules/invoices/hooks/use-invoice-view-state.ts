'use client';

import { useCallback, useRef, useState } from 'react';
import { apiCall, peekPrefetchedApiResult, rememberPrefetchedApiResult, useLatestRequestGuard } from '@/components/workspace/shared';
import type { Invoice } from '@/lib/store';

export function useInvoiceViewState({
  setInvoices,
  setLoading,
}: {
  setInvoices: (invoices: Invoice[]) => void;
  setLoading: (loading: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const invoiceImportInputRef = useRef<HTMLInputElement | null>(null);
  const requestGuard = useLatestRequestGuard();

  const loadInvoices = useCallback(async () => {
    const requestToken = requestGuard.nextToken();
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    const endpoint = `invoice${params.toString() ? `?${params.toString()}` : ''}`;
    const cachedResult = trimmedSearch ? null : peekPrefetchedApiResult<{ success?: boolean; data?: Invoice[] }>(endpoint);

    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      if (requestGuard.isLatest(requestToken)) {
        setInvoices(cachedResult.data);
        setLoading(false);
      }
    } else {
      setLoading(true);
    }

    try {
      const result = await apiCall(endpoint);
      if (!requestGuard.isLatest(requestToken)) return;
      if (result.success) {
        setInvoices(result.data);
        if (!trimmedSearch) {
          rememberPrefetchedApiResult(endpoint, result);
        }
      }
    } finally {
      if (requestGuard.isLatest(requestToken)) {
        setLoading(false);
      }
    }
  }, [requestGuard, search, setInvoices, setLoading]);

  const toggleInvoice = useCallback((invoiceId: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoiceId)) {
        next.delete(invoiceId);
      } else {
        next.add(invoiceId);
      }
      return next;
    });
  }, []);

  return {
    search,
    setSearch,
    expandedInvoices,
    invoiceImportInputRef,
    loadInvoices,
    toggleInvoice,
  };
}
