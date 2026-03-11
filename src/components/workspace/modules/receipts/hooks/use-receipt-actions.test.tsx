import { act, renderHook } from '@testing-library/react';
import { useReceiptActions } from './use-receipt-actions';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useReceiptActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const loadReceipts = jest.fn(async () => undefined);
  const setOcrResult = jest.fn();
  const setOcrCustomerMark = jest.fn();
  const setOcrCustomerName = jest.fn();
  const setOcrCustomerId = jest.fn();
  const setOcrCustomerCandidates = jest.fn();
  const setImagePreview = jest.fn();
  const setSelectedFile = jest.fn();
  const setSavedImagePath = jest.fn();
  const setError = jest.fn();
  const handleShowUploadChange = jest.fn();
  const handleShowDirectCreateChange = jest.fn();
  const resetDirectForm = jest.fn();

  beforeEach(() => {
    mockApiCall.mockReset();
    loadReceipts.mockClear();
    setError.mockClear();
    handleShowDirectCreateChange.mockClear();
    resetDirectForm.mockClear();
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createDeps(overrides: Partial<Parameters<typeof useReceiptActions>[0]> = {}) {
    return {
      tx,
      loadReceipts,
      selectedFile: null,
      ocrResult: null,
      ocrCustomerMark: '',
      ocrCustomerName: '',
      ocrCustomerId: '',
      savedImagePath: null,
      directForm: {
        receiptNo: 'RCPT-1',
        date: '2026-03-11',
        tel: '',
        usd: '120',
        invNo: '',
        orderNo: 'MAB-1-01',
        payer: 'payer',
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
        isDeposit: false,
      },
      setOcrResult,
      setOcrCustomerMark,
      setOcrCustomerName,
      setOcrCustomerId,
      setOcrCustomerCandidates,
      setImagePreview,
      setSelectedFile,
      setSavedImagePath,
      setError,
      handleShowUploadChange,
      handleShowDirectCreateChange,
      resetDirectForm,
      ...overrides,
    };
  }

  it('blocks direct create when customer mark is empty', async () => {
    const { result } = renderHook(() => useReceiptActions(createDeps({
      directForm: {
        receiptNo: '',
        date: '',
        tel: '',
        usd: '120',
        invNo: '',
        orderNo: 'MAB-1-01',
        payer: '',
        customerMark: '   ',
        customerName: '',
        customerId: '',
        isDeposit: false,
      },
    })));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('客户MARK不能为空');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('creates receipt directly and refreshes list on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(mockApiCall).toHaveBeenCalledWith('receipt', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'direct-create',
        receiptNo: 'RCPT-1',
        date: '2026-03-11',
        tel: null,
        usd: 120,
        invNo: null,
        orderNo: 'MAB-1-01',
        payer: 'payer',
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
        isDeposit: false,
      }),
    }));
    expect(handleShowDirectCreateChange).toHaveBeenCalledWith(false);
    expect(resetDirectForm).toHaveBeenCalled();
    expect(loadReceipts).toHaveBeenCalled();
  });

  it('submits receipt deletion request and reloads on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteReceipt('receipt-1');
    });

    expect(mockApiCall).toHaveBeenCalledWith('deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'RECEIPT',
        targetId: 'receipt-1',
      }),
    }));
    expect(window.alert).toHaveBeenCalledWith('删除申请已提交，等待管理员审批');
    expect(loadReceipts).toHaveBeenCalled();
  });
});
