'use client';

import { useCallback, useEffect, useRef } from 'react';
import { fetchCustomerCandidatesByMark, type CustomerCandidate } from '@/components/workspace/shared';

export function useInvoiceCustomerLookup() {
  const lookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (lookupTimerRef.current) {
        clearTimeout(lookupTimerRef.current);
      }
    };
  }, []);

  const loadCustomerCandidates = useCallback((
    mark: string,
    setter: (rows: CustomerCandidate[]) => void,
    setDefaultName?: (value: string) => void,
    setDefaultId?: (value: string) => void,
    setDefaultPhone?: (value: string) => void,
    setDefaultCity?: (value: string) => void,
  ) => {
    const normalized = mark.trim();
    if (lookupTimerRef.current) {
      clearTimeout(lookupTimerRef.current);
      lookupTimerRef.current = null;
    }
    if (!normalized) {
      setter([]);
      if (setDefaultName) setDefaultName('');
      if (setDefaultId) setDefaultId('');
      return;
    }

    lookupTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchCustomerCandidatesByMark(normalized);
          if (!result.success || !Array.isArray(result.data)) {
            setter([]);
            return;
          }
          const rows: CustomerCandidate[] = result.data.map((row) => ({
            id: row.id,
            mark: row.mark,
            orderName: row.orderName || row.name || '',
            displayName: row.name || '',
            phone: row.phone ?? null,
            city: row.city ?? null,
          }));
          setter(rows);
          if (rows.length === 1) {
            if (setDefaultName) setDefaultName(rows[0].orderName);
            if (setDefaultId) setDefaultId(rows[0].id);
            if (setDefaultPhone) setDefaultPhone(rows[0].phone || '');
            if (setDefaultCity) setDefaultCity(rows[0].city || '');
          }
        } catch {
          setter([]);
        }
      })();
    }, 220);
  }, []);

  return {
    loadCustomerCandidates,
  };
}
