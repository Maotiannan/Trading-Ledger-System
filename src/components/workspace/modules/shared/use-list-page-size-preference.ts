'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/components/workspace/shared';
import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  LIST_PAGE_SIZE_OPTIONS,
  normalizeListPageSizePreference,
  type ListPageSizeOption,
  type UserListPageSizePreference,
} from '@/lib/list-page-size-preference';

type ListPageSizePreferenceKey = keyof UserListPageSizePreference;

export function useListPageSizePreference(key: ListPageSizePreferenceKey) {
  const [listPageSizes, setListPageSizes] = useState<UserListPageSizePreference>(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE);
  const [pageSize, setPageSize] = useState<ListPageSizeOption>(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE[key]);

  useEffect(() => {
    let cancelled = false;
    void apiCall('settings?view=user-preferences')
      .then((result) => {
        if (cancelled || !result.success) return;
        const next = normalizeListPageSizePreference(
          result.data && typeof result.data === 'object'
            ? (result.data as { listPageSizes?: unknown }).listPageSizes
            : null,
        );
        setListPageSizes(next);
        setPageSize(next[key]);
      })
      .catch(() => {
        // Page-size persistence is best effort; default pagination must still work offline/weak-network.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const savePageSize = useCallback((nextPageSize: number) => {
    const next = normalizeListPageSizePreference({
      ...listPageSizes,
      [key]: nextPageSize,
    });
    setListPageSizes(next);
    setPageSize(next[key]);
    void apiCall('settings', {
      method: 'POST',
      body: JSON.stringify({
        action: 'update-user-preferences',
        preferences: { listPageSizes: next },
      }),
    }).then((result) => {
      if (!result.success || !result.data || typeof result.data !== 'object') return;
      const saved = normalizeListPageSizePreference((result.data as { listPageSizes?: unknown }).listPageSizes);
      setListPageSizes(saved);
      setPageSize(saved[key]);
    }).catch(() => {
      // Keep the local selection even if persistence fails; user can continue using the page.
    });
  }, [key, listPageSizes]);

  return {
    pageSize,
    pageSizeOptions: LIST_PAGE_SIZE_OPTIONS,
    savePageSize,
  };
}
