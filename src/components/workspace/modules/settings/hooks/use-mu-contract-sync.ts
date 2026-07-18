'use client';

import { useCallback, useState } from 'react';

import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import type {
  MuContractReconcilePreview,
  MuContractSyncAction,
  MuContractSyncStatus,
} from '../types';

type Props = {
  enabled: boolean;
  tx: (zh: string, en: string) => string;
  setMessage: (value: string | null) => void;
  setError: (value: string | null) => void;
};

function normalizeStatus(value: unknown): MuContractSyncStatus {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof row[key] === 'string' ? row[key] as string : null;
  const count = (key: string) => Number.isFinite(Number(row[key])) ? Number(row[key]) : 0;
  return {
    enabled: row.enabled === true,
    intervalSeconds: count('intervalSeconds') || 30,
    batchSize: count('batchSize') || 100,
    initialReconcileCompletedAt: text('initialReconcileCompletedAt'),
    committedCursor: text('committedCursor'),
    lastAttemptAt: text('lastAttemptAt'),
    lastSuccessAt: text('lastSuccessAt'),
    lastError: text('lastError'),
    nextEligiblePollAt: text('nextEligiblePollAt'),
    running: row.running === true,
    reconcileStatus: text('reconcileStatus') || 'IDLE',
    unmatchedCount: count('unmatchedCount'),
    conflictCount: count('conflictCount'),
  };
}

export function useMuContractSync({ enabled, tx, setMessage, setError }: Props) {
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<MuContractSyncAction>(null);
  const [status, setStatus] = useState<MuContractSyncStatus | null>(null);
  const [preview, setPreview] = useState<MuContractReconcilePreview | null>(null);

  const loadStatus = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const result = await apiCall('integrations/mu-contract/status');
      if (result.success) setStatus(normalizeStatus(result.data));
    } catch (error) {
      setError(getApiErrorMessage(error, tx('同步状态加载失败', 'Failed to load synchronization status')));
    } finally {
      setLoading(false);
    }
  }, [enabled, setError, tx]);

  const postAction = useCallback(async (
    nextAction: Exclude<MuContractSyncAction, null>,
    payload: Record<string, unknown>,
  ) => {
    setAction(nextAction);
    setError(null);
    setMessage(null);
    try {
      return await apiCall('integrations/mu-contract/actions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      setError(getApiErrorMessage(error, tx('同步操作失败', 'Synchronization action failed')));
      return null;
    } finally {
      setAction(null);
    }
  }, [setError, setMessage, tx]);

  const syncNow = useCallback(async () => {
    const result = await postAction('sync-now', { action: 'sync-now' });
    if (!result?.success) return;
    setMessage(result.message || tx('增量同步已完成', 'Incremental sync completed'));
    await loadStatus();
  }, [loadStatus, postAction, setMessage, tx]);

  const previewReconcile = useCallback(async () => {
    const result = await postAction('preview-reconcile', { action: 'preview-reconcile' });
    if (!result?.success || !result.data) return;
    setPreview(result.data as MuContractReconcilePreview);
    setMessage(result.message || tx('对账预览已生成', 'Reconcile preview generated'));
  }, [postAction, setMessage, tx]);

  const applyReconcile = useCallback(async () => {
    if (!preview) return;
    const confirmed = window.confirm(tx(
      `确认执行 Full Reconcile？仅挂接 ${preview.summary.metadataOnly} 条，新建 ${preview.summary.creates} 条，手工保留 ${preview.summary.manualOnlyUntouched} 条。`,
      `Apply Full Reconcile? Metadata-only: ${preview.summary.metadataOnly}, creates: ${preview.summary.creates}, manual untouched: ${preview.summary.manualOnlyUntouched}.`,
    ));
    if (!confirmed) return;

    const result = await postAction('apply-reconcile', {
      action: 'apply-reconcile',
      previewId: preview.previewId,
    });
    if (!result?.success) return;
    setPreview(null);
    setMessage(result.message || tx('Full Reconcile 已完成', 'Full Reconcile completed'));
    await loadStatus();
  }, [loadStatus, postAction, preview, setMessage, tx]);

  return {
    loading,
    action,
    status,
    preview,
    loadStatus,
    syncNow,
    previewReconcile,
    applyReconcile,
  };
}
