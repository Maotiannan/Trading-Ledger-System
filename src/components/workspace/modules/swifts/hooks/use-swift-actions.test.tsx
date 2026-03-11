import { act, renderHook } from '@testing-library/react';
import { useSwiftActions } from './use-swift-actions';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useSwiftActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const mockFetch = jest.fn();
  const OriginalFileReader = global.FileReader;
  const originalFetch = global.fetch;
  const loadSwifts = jest.fn(async () => undefined);
  const setOcrResult = jest.fn();
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
    loadSwifts.mockClear();
    setOcrResult.mockClear();
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

  function createDeps(overrides: Partial<Parameters<typeof useSwiftActions>[0]> = {}) {
    return {
      tx,
      loadSwifts,
      selectedFile: null,
      ocrResult: null,
      selectedDetailId: '',
      savedImagePath: null,
      directForm: {
        detailId: 'detail-1',
        amount: '330',
        date: '2026-03-11',
        senderName: 'Sender A',
        senderAddress: '',
        receiverName: 'Receiver B',
        receiverAccount: '',
      },
      setOcrResult,
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

  it('recognizes uploaded swift image', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          ocrResult: { amount: 330, senderName: 'Sender A' },
          image: { path: '/uploads/swift.png', name: 'swift.png' },
        },
      }),
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(setOcrResult).toHaveBeenCalledWith({ amount: 330, senderName: 'Sender A' });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/swift.png', name: 'swift.png' });
  });

  it('requires a linked detail before confirming OCR swift', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330 },
      selectedDetailId: '',
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('请选择付款明细');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('confirms OCR swift creation and refreshes list', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330 },
      selectedDetailId: 'detail-1',
      savedImagePath: { path: '/uploads/swift.png', name: 'swift.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    const [, request] = mockFetch.mock.calls[0] as [string, { body: FormData }];
    expect(request.body.get('action')).toBe('confirm');
    expect(request.body.get('detailId')).toBe('detail-1');
    expect(handleShowUploadChange).toHaveBeenCalledWith(false);
    expect(setSelectedFile).toHaveBeenCalledWith(null);
    expect(setSavedImagePath).toHaveBeenCalledWith(null);
    expect(loadSwifts).toHaveBeenCalled();
  });

  it('creates swift directly and refreshes list on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(mockApiCall).toHaveBeenCalledWith('swift', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'direct-create',
        detailId: 'detail-1',
        amount: 330,
        date: '2026-03-11',
        senderName: 'Sender A',
        senderAddress: null,
        receiverName: 'Receiver B',
        receiverAccount: null,
      }),
    }));
    expect(handleShowDirectCreateChange).toHaveBeenCalledWith(false);
    expect(resetDirectForm).toHaveBeenCalled();
    expect(loadSwifts).toHaveBeenCalled();
  });

  it('surfaces direct-create exception messages', async () => {
    mockApiCall.mockRejectedValue(new Error('swift create failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('swift create failed');
  });

  it('deletes erroneous swift directly without approval flow', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-err',
        hasError: true,
      } as never);
    });

    expect(mockApiCall).toHaveBeenCalledWith('swift', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'delete',
        swiftId: 'swift-err',
      }),
    }));
    expect(loadSwifts).toHaveBeenCalled();
  });

  it('alerts when direct deletion of erroneous swift fails', async () => {
    mockApiCall.mockRejectedValue(new Error('delete failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-err',
        hasError: true,
      } as never);
    });

    expect(getErrorMessage).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('delete failed');
  });

  it('submits deletion request for normal swift', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-ok',
        hasError: false,
      } as never);
    });

    expect(mockApiCall).toHaveBeenCalledWith('deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'SWIFT',
        targetId: 'swift-ok',
      }),
    }));
    expect(window.alert).toHaveBeenCalledWith('删除申请已提交，等待管理员审批');
    expect(loadSwifts).toHaveBeenCalled();
  });

  it('does not submit normal deletion request when cancelled', async () => {
    jest.spyOn(window, 'confirm').mockImplementation(() => false);
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-ok',
        hasError: false,
      } as never);
    });

    expect(mockApiCall).not.toHaveBeenCalled();
  });
});
