import { act, renderHook } from '@testing-library/react';
import { useInvoiceViewState } from './use-invoice-view-state';
import { apiCall, peekPrefetchedApiResult, rememberPrefetchedApiResult, useLatestRequestGuard } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    peekPrefetchedApiResult: jest.fn(() => null),
    rememberPrefetchedApiResult: jest.fn((_endpoint: string, value: unknown) => value),
    useLatestRequestGuard: jest.fn(() => ({
      nextToken: () => 1,
      isLatest: () => true,
    })),
  };
});

const mockApiCall = apiCall as jest.Mock;
const mockPeekPrefetchedApiResult = peekPrefetchedApiResult as jest.Mock;
const mockRememberPrefetchedApiResult = rememberPrefetchedApiResult as jest.Mock;
const mockUseLatestRequestGuard = useLatestRequestGuard as jest.Mock;

describe('useInvoiceViewState', () => {
  beforeEach(() => {
    mockApiCall.mockReset();
    mockPeekPrefetchedApiResult.mockReset();
    mockPeekPrefetchedApiResult.mockReturnValue(null);
    mockRememberPrefetchedApiResult.mockClear();
    mockUseLatestRequestGuard.mockReturnValue({
      nextToken: () => 1,
      isLatest: () => true,
    });
  });

  it('loads invoices with trimmed search and toggles expanded rows', async () => {
    const setInvoices = jest.fn();
    const setLoading = jest.fn();
    mockApiCall.mockResolvedValue({ success: true, data: [{ id: 'inv-1', invNo: 'INV-1', orders: [] }] });

    const { result } = renderHook(() => useInvoiceViewState({ setInvoices, setLoading }));

    act(() => {
      result.current.setSearch(' INV-1 ');
    });

    await act(async () => {
      await result.current.loadInvoices();
    });

    expect(apiCall).toHaveBeenCalledWith('invoice?search=INV-1');
    expect(setLoading).toHaveBeenNthCalledWith(1, true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(setInvoices).toHaveBeenCalledWith([{ id: 'inv-1', invNo: 'INV-1', orders: [] }]);

    act(() => {
      result.current.toggleInvoice('inv-1');
    });
    expect(result.current.expandedInvoices.has('inv-1')).toBe(true);

    act(() => {
      result.current.toggleInvoice('inv-1');
    });
    expect(result.current.expandedInvoices.has('inv-1')).toBe(false);
  });

  it('hydrates from prefetched invoices before refreshing the default list', async () => {
    const setInvoices = jest.fn();
    const setLoading = jest.fn();
    mockPeekPrefetchedApiResult.mockReturnValueOnce({
      success: true,
      data: [{ id: 'cached-1', invNo: 'CACHED-1', orders: [] }],
    });
    mockApiCall.mockResolvedValue({ success: true, data: [{ id: 'fresh-1', invNo: 'FRESH-1', orders: [] }] });

    const { result } = renderHook(() => useInvoiceViewState({ setInvoices, setLoading }));

    await act(async () => {
      await result.current.loadInvoices();
    });

    expect(mockPeekPrefetchedApiResult).toHaveBeenCalledWith('invoice');
    expect(setInvoices).toHaveBeenNthCalledWith(1, [{ id: 'cached-1', invNo: 'CACHED-1', orders: [] }]);
    expect(setInvoices).toHaveBeenLastCalledWith([{ id: 'fresh-1', invNo: 'FRESH-1', orders: [] }]);
    expect(setLoading).toHaveBeenCalledWith(false);
    expect(mockRememberPrefetchedApiResult).toHaveBeenCalledWith('invoice', { success: true, data: [{ id: 'fresh-1', invNo: 'FRESH-1', orders: [] }] });
  });

  it('ignores stale cached and api responses when request token is no longer latest', async () => {
    const setInvoices = jest.fn();
    const setLoading = jest.fn();
    mockPeekPrefetchedApiResult.mockReturnValueOnce({
      success: true,
      data: [{ id: 'cached-1', invNo: 'CACHED-1', orders: [] }],
    });
    mockApiCall.mockResolvedValue({ success: true, data: [{ id: 'stale-1', invNo: 'STALE-1', orders: [] }] });

    let callCount = 0;
    mockUseLatestRequestGuard.mockReturnValue({
      nextToken: () => 1,
      isLatest: () => {
        callCount += 1;
        return false;
      },
    });

    const { result } = renderHook(() => useInvoiceViewState({ setInvoices, setLoading }));

    await act(async () => {
      await result.current.loadInvoices();
    });

    expect(setInvoices).not.toHaveBeenCalled();
    expect(setLoading).not.toHaveBeenCalledWith(false);
    expect(mockRememberPrefetchedApiResult).not.toHaveBeenCalled();
    expect(callCount).toBeGreaterThanOrEqual(2);
  });
});
