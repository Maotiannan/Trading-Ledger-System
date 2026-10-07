'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/components/workspace/shared';
import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  getListPageSizeOptions,
  normalizeListPageSizePreference,
  type UserListPageSizePreference,
} from '@/lib/list-page-size-preference';
import {
  loadClientUserPreferences,
  rememberClientUserPreferences,
} from './user-preferences-cache';

type ListPageSizePreferenceKey = keyof UserListPageSizePreference;

export function useListPageSizePreference(key: ListPageSizePreferenceKey) {
  const [listPageSizes, setListPageSizes] = useState<UserListPageSizePreference>(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE[key]);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void loadClientUserPreferences()
      .then((preferences) => {
        if (cancelled) return;
        const next = normalizeListPageSizePreference(preferences.listPageSizes);
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
    setSaveError('');
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
        preferences: { listPageSizes: { [key]: next[key] } },
      }),
    }).then((result) => {
      if (!result.success || !result.data || typeof result.data !== 'object') {
        setSaveError(String(result.message || result.error || 'Failed to save page size setting.'));
        return;
      }
      const saved = normalizeListPageSizePreference((result.data as { listPageSizes?: unknown }).listPageSizes);
      setListPageSizes(saved);
      setPageSize(saved[key]);
      rememberClientUserPreferences(result.data);
    }).catch(() => {
      setSaveError('Failed to save page size setting.');
    });
  }, [key, listPageSizes]);

  return {
    pageSize,
    pageSizeOptions: getListPageSizeOptions(key),
    savePageSize,
    saveError,
  };
}
