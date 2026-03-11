import { act, renderHook } from '@testing-library/react';
import { useDetailActions } from './use-detail-actions';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useDetailActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const mockFetch = jest.fn();
  const OriginalFileReader = global.FileReader;
  const originalFetch = global.fetch;
  const loadDetails = jest.fn(async () => undefined);
  const setOcrResult = jest.fn();
  const setImagePreview = jest.fn();
  const setSelectedFile = jest.fn();
  const setError = jest.fn();
  const setSavedImagePath = jest.fn();
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
    loadDetails.mockClear();
    setOcrResult.mockClear();
    setImagePreview.mockClear();
    setSelectedFile.mockClear();
    setError.mockClear();
    setSavedImagePath.mockClear();
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

  function createDeps(overrides: Partial<Parameters<typeof useDetailActions>[0]> = {}) {
    return {
      tx,
      loadDetails,
      selectedFile: null,
      ocrResult: null,
      savedImagePath: null,
      directDate: '2026-03-11',
      directItems: [
        { mark: 'MAB-1', orderNo: 'MAB-1-01', amount: '120' },
        { mark: '', orderNo: '', amount: '' },
      ],
      setOcrResult,
      setImagePreview,
      setSelectedFile,
      setError,
      setSavedImagePath,
      handleShowUploadChange,
      handleShowDirectCreateChange,
      resetDirectForm,
      ...overrides,
    };
  }

  it('recognizes uploaded payment detail image', async () => {
    const file = new File(['detail'], 'detail.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          ocrResult: { date: '2026-03-11', items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }] },
          image: { path: '/uploads/detail.png', name: 'detail.png' },
        },
      }),
    });
    const { result } = renderHook(() => useDetailActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(setOcrResult).toHaveBeenCalledWith({ date: '2026-03-11', items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }] });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/detail.png', name: 'detail.png' });
  });

  it('confirms OCR-created payment details and refreshes list', async () => {
    const file = new File(['detail'], 'detail.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const { result } = renderHook(() => useDetailActions(createDeps({
      selectedFile: file,
      ocrResult: { date: '2026-03-11', items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }] },
      savedImagePath: { path: '/uploads/detail.png', name: 'detail.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    const [, request] = mockFetch.mock.calls[0] as [string, { body: FormData }];
    expect(request.body.get('action')).toBe('confirm');
    expect(request.body.get('imagePath')).toBe('/uploads/detail.png');
    expect(handleShowUploadChange).toHaveBeenCalledWith(false);
    expect(setSelectedFile).toHaveBeenCalledWith(null);
    expect(setSavedImagePath).toHaveBeenCalledWith(null);
    expect(loadDetails).toHaveBeenCalled();
  });

  it('creates detail directly and refreshes list on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useDetailActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(mockApiCall).toHaveBeenCalledWith('detail', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'direct-create',
        date: '2026-03-11',
        items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }],
      }),
    }));
    expect(handleShowDirectCreateChange).toHaveBeenCalledWith(false);
    expect(resetDirectForm).toHaveBeenCalled();
    expect(loadDetails).toHaveBeenCalled();
  });

  it('surfaces direct-create failures from API', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '创建失败' });
    const { result } = renderHook(() => useDetailActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('创建失败');
  });

  it('submits detail deletion request and reloads on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useDetailActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteDetail('detail-1');
    });

    expect(mockApiCall).toHaveBeenCalledWith('deletion', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'DETAIL',
        targetId: 'detail-1',
      }),
    }));
    expect(window.alert).toHaveBeenCalledWith('删除申请已提交，等待管理员审批');
    expect(loadDetails).toHaveBeenCalled();
  });

  it('does not submit deletion request when user cancels', async () => {
    jest.spyOn(window, 'confirm').mockImplementation(() => false);
    const { result } = renderHook(() => useDetailActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteDetail('detail-2');
    });

    expect(mockApiCall).not.toHaveBeenCalled();
  });
});
