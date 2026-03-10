import { act, renderHook } from '@testing-library/react';
import { useInvoiceViewState } from './use-invoice-view-state';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
  };
});

const mockApiCall = apiCall as jest.Mock;

describe('useInvoiceViewState', () => {
  beforeEach(() => {
    mockApiCall.mockReset();
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
});
