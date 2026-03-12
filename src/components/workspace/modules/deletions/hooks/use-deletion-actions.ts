'use client';

import { useCallback } from 'react';
import { apiCall, peekPrefetchedApiResult, rememberPrefetchedApiResult } from '@/components/workspace/shared';
import type { DeletionRequest } from '@/lib/store';

export function useDeletionActions({
  setDeletionRequests,
}: {
  setDeletionRequests: (requests: DeletionRequest[]) => void;
}) {
  const loadRequests = useCallback(async () => {
    const endpoint = 'deletion';
    const cachedResult = peekPrefetchedApiResult<{ success?: boolean; data?: DeletionRequest[] }>(endpoint);
    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      setDeletionRequests(cachedResult.data);
    }
    const result = await apiCall(endpoint);
    if (result.success) {
      setDeletionRequests(result.data as DeletionRequest[]);
      rememberPrefetchedApiResult(endpoint, result);
    }
  }, [setDeletionRequests]);

  const handleApprove = useCallback(async (requestId: string) => {
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', requestId }),
    });
    if (result.success) {
      await loadRequests();
    }
  }, [loadRequests]);

  const handleReject = useCallback(async (requestId: string) => {
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ action: 'reject', requestId }),
    });
    if (result.success) {
      await loadRequests();
    }
  }, [loadRequests]);

  return {
    loadRequests,
    handleApprove,
    handleReject,
  };
}
