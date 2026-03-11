import { act, renderHook } from '@testing-library/react';
import { apiCall } from '@/components/workspace/shared';
import { useDeletionActions } from './use-deletion-actions';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useDeletionActions', () => {
  beforeEach(() => {
    mockApiCall.mockReset();
  });

  it('loads deletion requests into store state', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'req-1', status: 'PENDING' }],
    });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.loadRequests();
    });

    expect(mockApiCall).toHaveBeenCalledWith('deletion');
    expect(setDeletionRequests).toHaveBeenCalledWith([{ id: 'req-1', status: 'PENDING' }]);
  });

  it('does not update store when loading requests fails', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall.mockResolvedValueOnce({
      success: false,
      error: 'load failed',
    });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.loadRequests();
    });

    expect(setDeletionRequests).not.toHaveBeenCalled();
  });

  it('approves a request and reloads the list on success', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: [{ id: 'req-2', status: 'APPROVED' }] });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.handleApprove('req-2');
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'approve', requestId: 'req-2' }),
    }));
    expect(mockApiCall).toHaveBeenNthCalledWith(2, 'deletion');
    expect(setDeletionRequests).toHaveBeenCalledWith([{ id: 'req-2', status: 'APPROVED' }]);
  });

  it('does not reload when reject request fails', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall.mockResolvedValueOnce({ success: false, error: 'reject failed' });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.handleReject('req-3');
    });

    expect(mockApiCall).toHaveBeenCalledTimes(1);
    expect(mockApiCall).toHaveBeenCalledWith('deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reject', requestId: 'req-3' }),
    }));
    expect(setDeletionRequests).not.toHaveBeenCalled();
  });

  it('does not reload when approve request fails', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall.mockResolvedValueOnce({ success: false, error: 'approve failed' });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.handleApprove('req-4');
    });

    expect(mockApiCall).toHaveBeenCalledTimes(1);
    expect(setDeletionRequests).not.toHaveBeenCalled();
  });

  it('rejects a request and reloads the list on success', async () => {
    const setDeletionRequests = jest.fn();
    mockApiCall
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, data: [{ id: 'req-5', status: 'REJECTED' }] });

    const { result } = renderHook(() => useDeletionActions({ setDeletionRequests }));

    await act(async () => {
      await result.current.handleReject('req-5');
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reject', requestId: 'req-5' }),
    }));
    expect(mockApiCall).toHaveBeenNthCalledWith(2, 'deletion');
    expect(setDeletionRequests).toHaveBeenCalledWith([{ id: 'req-5', status: 'REJECTED' }]);
  });
});
