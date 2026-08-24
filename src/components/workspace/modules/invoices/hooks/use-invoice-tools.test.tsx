import { act, renderHook } from '@testing-library/react';
import { apiCall } from '@/components/workspace/shared';
import { useInvoiceTools } from './use-invoice-tools';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((_error: unknown, fallback: string) => fallback),
  toDateInputValue: jest.fn(() => ''),
}));

const mockApiCall = apiCall as jest.Mock;
const tx = (_zh: string, en: string) => en;
const currentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
};

describe('useInvoiceTools rematch system-pool flow', () => {
  const loadInvoices = jest.fn(async () => undefined);
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('loads structured preview data and sends only explicit manual pool choices', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        data: {
          groups: [],
          poolRepairs: [
            {
              sourceOrderId: 'pool-auto',
              orderNo: 'AB-12',
              sourcePool: 'DEPOSIT_POOL',
              amount: 10000,
              orderBalance: 8000,
              receiptCount: 1,
              repairMode: 'AUTO',
              targetOrderId: 'formal-1',
              targetInvoiceId: 'invoice-1',
              targetInvNo: 'INV-001',
            },
            {
              sourceOrderId: 'pool-manual',
              orderNo: 'AB-13B',
              sourcePool: 'DEPOSIT_POOL',
              amount: 18000,
              orderBalance: 14000,
              receiptCount: 1,
              repairMode: 'MANUAL',
              targetOrderId: null,
              targetInvoiceId: null,
              targetInvNo: null,
            },
          ],
          targetInvoices: [
            { id: 'invoice-1', invNo: 'INV-001' },
            { id: 'invoice-2', invNo: 'INV-002' },
          ],
        },
      })
      .mockResolvedValueOnce({ success: true, message: 'applied' });

    const { result } = renderHook(() => useInvoiceTools(tx, loadInvoices, currentUser));

    await act(async () => {
      await result.current.openRematchDialog();
    });

    expect(result.current.rematchGroups).toEqual([]);
    expect(result.current.poolRepairs).toHaveLength(2);
    expect(result.current.rematchTargetInvoices).toEqual([
      { id: 'invoice-1', invNo: 'INV-001' },
      { id: 'invoice-2', invNo: 'INV-002' },
    ]);

    act(() => {
      result.current.updatePoolSelection('pool-manual', 'invoice-2');
    });

    await act(async () => {
      await result.current.handleRematchApply();
    });

    const applyRequest = mockApiCall.mock.calls[1][1];
    expect(JSON.parse(applyRequest.body)).toEqual({
      action: 'rematch-apply',
      resolutions: [],
      poolResolutions: [{ sourceOrderId: 'pool-manual', targetInvoiceId: 'invoice-2' }],
    });
    expect(loadInvoices).toHaveBeenCalled();
  });
});
