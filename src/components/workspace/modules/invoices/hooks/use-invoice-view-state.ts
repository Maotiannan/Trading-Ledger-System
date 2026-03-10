'use client';

import { useCallback, useRef, useState } from 'react';
import { apiCall } from '@/components/workspace/shared';
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

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      const result = await apiCall(`invoice${params.toString() ? `?${params.toString()}` : ''}`);
      if (result.success) {
        setInvoices(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, [search, setInvoices, setLoading]);

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
