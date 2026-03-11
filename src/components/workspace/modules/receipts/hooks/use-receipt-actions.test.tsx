import { act, renderHook } from '@testing-library/react';
import { useReceiptActions } from './use-receipt-actions';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useReceiptActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const mockFetch = jest.fn();
  const OriginalFileReader = global.FileReader;
  const originalFetch = global.fetch;
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

  class MockFileReader {
    result: string | ArrayBuffer | null = 'data:image/png;base64,mock';
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

    readAsDataURL(_file: Blob) {
      if (this.onload) {
        this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
      }
    }
  }

  beforeEach(() => {
    mockApiCall.mockReset();
    mockFetch.mockReset();
    loadReceipts.mockClear();
    setOcrResult.mockClear();
    setOcrCustomerMark.mockClear();
    setOcrCustomerName.mockClear();
    setOcrCustomerId.mockClear();
    setOcrCustomerCandidates.mockClear();
    setImagePreview.mockClear();
    setSelectedFile.mockClear();
    setSavedImagePath.mockClear();
    setError.mockClear();
    handleShowUploadChange.mockClear();
    handleShowDirectCreateChange.mockClear();
    resetDirectForm.mockClear();
    global.FileReader = MockFileReader as unknown as typeof FileReader;
    global.fetch = mockFetch as unknown as typeof fetch;
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    global.FileReader = OriginalFileReader;
    global.fetch = originalFetch;
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

  it('recognizes uploaded receipt and stores OCR result', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          ocrResult: { receiptNo: 'OCR-1' },
          image: { path: '/uploads/receipt.png', name: 'receipt.png' },
        },
      }),
    });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(setOcrResult).toHaveBeenCalledWith({ receiptNo: 'OCR-1' });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/receipt.png', name: 'receipt.png' });
    expect(setOcrCustomerMark).toHaveBeenCalledWith('');
    expect(setOcrCustomerCandidates).toHaveBeenCalledWith([]);
  });

  it('confirms OCR receipt creation and reloads receipts', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const { result } = renderHook(() => useReceiptActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 120 },
      ocrCustomerMark: ' MAB-1 ',
      ocrCustomerName: 'MAB',
      ocrCustomerId: 'cust-1',
      savedImagePath: { path: '/uploads/receipt.png', name: 'receipt.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    const [, request] = mockFetch.mock.calls[0] as [string, { body: FormData }];
    expect(request.body.get('action')).toBe('confirm');
    expect(request.body.get('imagePath')).toBe('/uploads/receipt.png');
    expect(handleShowUploadChange).toHaveBeenCalledWith(false);
    expect(setSelectedFile).toHaveBeenCalledWith(null);
    expect(loadReceipts).toHaveBeenCalled();
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

  it('reports direct-create failure returned by API', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '创建失败' });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('创建失败');
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

  it('marks receipt as received and refreshes list on success', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleMarkReceived('receipt-2');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/receipt', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(loadReceipts).toHaveBeenCalled();
  });
});
