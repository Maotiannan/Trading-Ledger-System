import { act, renderHook, waitFor } from '@testing-library/react';
import { apiCall } from '@/components/workspace/shared';
import { useListPageSizePreference } from './use-list-page-size-preference';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useListPageSizePreference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads and saves a customer history page size with its dedicated options', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        data: {
          listPageSizes: {
            detail: 10,
            swift: 10,
            receipt: 20,
            customerHistoryOrders: 15,
            customerHistoryReceipts: 5,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          listPageSizes: {
            detail: 10,
            swift: 10,
            receipt: 20,
            customerHistoryOrders: 20,
            customerHistoryReceipts: 5,
          },
        },
      });

    const { result } = renderHook(() => useListPageSizePreference('customerHistoryOrders'));
    await waitFor(() => expect(result.current.pageSize).toBe(15));
    expect(result.current.pageSizeOptions).toEqual([5, 10, 15, 20]);

    act(() => result.current.savePageSize(20));
    await waitFor(() => expect(result.current.pageSize).toBe(20));
    expect(mockApiCall).toHaveBeenLastCalledWith('settings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'update-user-preferences',
        preferences: { listPageSizes: { customerHistoryOrders: 20 } },
      }),
    }));
  });

  it('keeps the selected size and exposes a readable error when persistence fails', async () => {
    mockApiCall
      .mockResolvedValueOnce({ success: true, data: { listPageSizes: {} } })
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useListPageSizePreference('customerHistoryReceipts'));
    await waitFor(() => expect(result.current.pageSize).toBe(10));

    act(() => result.current.savePageSize(15));

    await waitFor(() => expect(result.current.saveError).toBe('Failed to save page size setting.'));
    expect(result.current.pageSize).toBe(15);
  });
});
