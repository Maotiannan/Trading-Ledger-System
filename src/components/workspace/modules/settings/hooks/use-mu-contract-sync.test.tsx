import { act, renderHook, waitFor } from '@testing-library/react';

import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import { useMuContractSync } from './use-mu-contract-sync';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((_error: unknown, fallback: string) => fallback),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;
const tx = (_zh: string, en: string) => en;

function setup(enabled = true) {
  const setMessage = jest.fn();
  const setError = jest.fn();
  const hook = renderHook(() => useMuContractSync({ enabled, tx, setMessage, setError }));
  return { ...hook, setMessage, setError };
}

describe('useMuContractSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        intervalSeconds: 30,
        batchSize: 100,
        initialReconcileCompletedAt: null,
        committedCursor: null,
        unmatchedCount: 0,
        conflictCount: 0,
        running: false,
        reconcileStatus: 'IDLE',
      },
    });
  });

  it('does not request administrator status for a non-admin account', async () => {
    const { result } = setup(false);

    await act(async () => result.current.loadStatus());

    expect(mockApiCall).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('loads status and runs Sync Now through the controlled action API', async () => {
    const { result, setMessage } = setup();

    await act(async () => result.current.loadStatus());
    expect(mockApiCall).toHaveBeenCalledWith('integrations/mu-contract/status');

    mockApiCall
      .mockResolvedValueOnce({ success: true, data: { status: 'completed', processed: 1 }, message: 'Sync complete' })
      .mockResolvedValueOnce({ success: true, data: { enabled: true, committedCursor: '1042' } });
    await act(async () => result.current.syncNow());

    expect(mockApiCall).toHaveBeenCalledWith('integrations/mu-contract/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'sync-now' }),
    });
    expect(setMessage).toHaveBeenCalledWith('Sync complete');
    expect(result.current.action).toBeNull();
    expect(result.current.status).toEqual(expect.objectContaining({ committedCursor: '1042' }));
  });

  it('stores preview counts and requires a second confirmation before apply', async () => {
    const preview = {
      previewId: 'preview-1',
      expiresAt: '2026-07-18T09:20:00.000Z',
      highWatermark: '1042',
      summary: {
        totalSourceRows: 53,
        metadataOnly: 39,
        creates: 14,
        updates: 0,
        inactive: 0,
        unmatched: 0,
        conflicts: 0,
        manualOnlyUntouched: 10,
      },
    };
    mockApiCall.mockResolvedValueOnce({ success: true, data: preview });
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = setup();

    await act(async () => result.current.previewReconcile());
    expect(result.current.preview).toEqual(preview);

    await act(async () => result.current.applyReconcile());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Apply Full Reconcile? Metadata-only: 39, creates: 14, manual untouched: 10.',
    );
    expect(mockApiCall).toHaveBeenCalledTimes(1);

    confirm.mockReturnValue(true);
    mockApiCall
      .mockResolvedValueOnce({ success: true, data: { status: 'completed' }, message: 'Reconcile complete' })
      .mockResolvedValueOnce({ success: true, data: { enabled: false, committedCursor: '1042' } });
    await act(async () => result.current.applyReconcile());

    expect(mockApiCall).toHaveBeenCalledWith('integrations/mu-contract/actions', {
      method: 'POST',
      body: JSON.stringify({ action: 'apply-reconcile', previewId: 'preview-1' }),
    });
    await waitFor(() => expect(result.current.preview).toBeNull());
    confirm.mockRestore();
  });

  it('returns readable errors without exposing response internals', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('secret upstream diagnostics'));
    mockGetApiErrorMessage.mockReturnValueOnce('Synchronization failed');
    const { result, setError } = setup();

    await act(async () => result.current.loadStatus());

    expect(setError).toHaveBeenCalledWith('Synchronization failed');
  });
});
