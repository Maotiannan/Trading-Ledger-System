import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useDetailActions } from './use-detail-actions';
import { apiCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import { uploadBusinessImage } from '@/components/workspace/modules/shared/business-image-upload';
import type { DetailOcrUploadStatus } from '../types';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).error || fallback);
    }
    if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).message || fallback);
    }
    return error instanceof Error ? error.message : fallback;
  }),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).error || fallback);
    }
    if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).message || fallback);
    }
    return error instanceof Error ? error.message : fallback;
  }),
}));

jest.mock('@/components/workspace/modules/shared/business-image-upload', () => ({
  uploadBusinessImage: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;
const mockUploadBusinessImage = uploadBusinessImage as jest.Mock;

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
    mockGetApiErrorMessage.mockClear();
    mockGetErrorMessage.mockClear();
    mockUploadBusinessImage.mockReset();
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
      setOcrUploadStatus: jest.fn(),
      setOcrUploadMessage: jest.fn(),
      setOcrUploadProgress: jest.fn(),
      handleShowUploadChange,
      handleShowDirectCreateChange,
      resetDirectForm,
      ...overrides,
    };
  }

  function renderStatefulDetailActions(overrides: Partial<Parameters<typeof useDetailActions>[0]> = {}) {
    const errorHistory: Array<string | null> = [];
    const ocrUploadStatusHistory: DetailOcrUploadStatus[] = [];
    const ocrUploadMessageHistory: Array<string | null> = [];
    const ocrUploadProgressHistory: Array<number | null> = [];

    const hook = renderHook(() => {
      const [selectedFile, setSelectedFile] = useState<File | null>(null);
      const [ocrResult, setOcrResult] = useState<{ date: string | null; items: Array<{ mark: string | null; orderNo: string | null; amount: number }> } | null>(null);
      const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
      const [imagePreview, setImagePreview] = useState<string | null>(null);
      const [ocrUploadStatus, setOcrUploadStatus] = useState<DetailOcrUploadStatus>('idle');
      const [ocrUploadMessage, setOcrUploadMessage] = useState<string | null>(null);
      const [ocrUploadProgress, setOcrUploadProgress] = useState<number | null>(null);
      const [error, setErrorState] = useState<string | null>(null);

      const actions = useDetailActions(createDeps({
        ...overrides,
        selectedFile,
        ocrResult,
        savedImagePath,
        setSelectedFile,
        setOcrResult,
        setSavedImagePath,
        setImagePreview,
        setOcrUploadStatus: (value) => {
          ocrUploadStatusHistory.push(value);
          setOcrUploadStatus(value);
        },
        setOcrUploadMessage: (value) => {
          ocrUploadMessageHistory.push(value);
          setOcrUploadMessage(value);
        },
        setOcrUploadProgress: (value) => {
          ocrUploadProgressHistory.push(value);
          setOcrUploadProgress(value);
        },
        setError: (value) => {
          errorHistory.push(value);
          setErrorState(value);
        },
      }));

      return {
        ...actions,
        selectedFile,
        ocrResult,
        savedImagePath,
        imagePreview,
        ocrUploadStatus,
        ocrUploadMessage,
        ocrUploadProgress,
        error,
      };
    });

    return {
      ...hook,
      history: {
        errorHistory,
        ocrUploadStatusHistory,
        ocrUploadMessageHistory,
        ocrUploadProgressHistory,
      },
    };
  }

  it('recognizes uploaded payment detail image via the shared upload pipeline', async () => {
    const file = new File(['detail'], 'detail.png', { type: 'image/png' });
    const setOcrUploadStatus = jest.fn();
    const setOcrUploadMessage = jest.fn();
    const setOcrUploadProgress = jest.fn();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    });
    mockUploadBusinessImage.mockImplementationOnce(async (options) => {
      options.onStageChange?.({ stage: 'compressing', progress: null, compressed: null });
      options.onStageChange?.({ stage: 'uploading', progress: 37, compressed: true, preparedFile: file });
      options.onStageChange?.({ stage: 'saving', progress: 100, compressed: true, preparedFile: file });
      return {
        prepared: {
          file,
          compressed: true,
          qualityUsed: 0.72,
          originalSize: file.size,
          outputSize: file.size,
          targetMaxBytes: 640 * 1024,
        },
        response: {
          success: true,
          data: {
            ocrResult: { date: '2026-03-11', items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }] },
            image: { path: '/uploads/detail.png', name: 'detail.png' },
          },
        },
      };
    });
    const { result } = renderHook(() => useDetailActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'detail.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(mockApiCall).toHaveBeenCalledWith('settings?view=user-preferences');
    expect(mockUploadBusinessImage).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'detail',
      compression: expect.objectContaining({
        preference: {
          imageCompressionEnabled: false,
          imageCompressionQualityFloor: 0.45,
          ocrTargetMaxKb: 640,
        },
      }),
    }));
    const [{ buildFormData }] = mockUploadBusinessImage.mock.calls[0] as [{ buildFormData: (input: File) => FormData }];
    const formData = buildFormData(file);
    expect(formData.get('action')).toBe('recognize');
    expect(formData.get('file')).toBe(file);
    expect(setOcrResult).toHaveBeenCalledWith({ date: '2026-03-11', items: [{ mark: 'MAB-1', orderNo: 'MAB-1-01', amount: 120 }] });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/detail.png', name: 'detail.png' });
    expect(setOcrUploadStatus).toHaveBeenLastCalledWith('success');
    expect(setOcrUploadMessage).toHaveBeenLastCalledWith('AI识别完成');
    expect(setOcrUploadProgress).toHaveBeenLastCalledWith(100);
    expect(result.current.uploading).toBe(false);
  });

  it('continues OCR upload with default compression behavior when loading preferences fails', async () => {
    const file = new File(['detail'], 'detail.png', { type: 'image/png' });
    const setOcrUploadStatus = jest.fn();
    const setOcrUploadMessage = jest.fn();
    const setOcrUploadProgress = jest.fn();
    mockApiCall.mockRejectedValueOnce(new Error('failed to fetch preferences'));
    mockUploadBusinessImage.mockResolvedValueOnce({
      prepared: {
        file,
        compressed: false,
        qualityUsed: null,
        originalSize: file.size,
        outputSize: file.size,
        targetMaxBytes: 500 * 1024,
      },
      response: {
        success: true,
        data: {
          ocrResult: { date: '2026-03-11', items: [{ mark: 'FB', orderNo: 'FB-01', amount: 88 }] },
          image: { path: '/uploads/detail-fallback.png', name: 'detail-fallback.png' },
        },
      },
    });
    const { result } = renderHook(() => useDetailActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'detail.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockUploadBusinessImage).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'detail',
      compression: expect.objectContaining({
        preference: undefined,
      }),
    }));
    expect(setOcrResult).toHaveBeenCalledWith({ date: '2026-03-11', items: [{ mark: 'FB', orderNo: 'FB-01', amount: 88 }] });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/detail-fallback.png', name: 'detail-fallback.png' });
    expect(setOcrUploadStatus).toHaveBeenLastCalledWith('success');
    expect(setOcrUploadProgress).toHaveBeenLastCalledWith(100);
    expect(setError).not.toHaveBeenCalledWith('failed to fetch preferences');
    expect(result.current.uploading).toBe(false);
  });

  it('clears OCR upload state and surfaces mapped upload errors after OCR upload aborts', async () => {
    const file = new File(['detail'], 'detail.png', { type: 'image/png' });
    const setOcrUploadStatus = jest.fn();
    const setOcrUploadMessage = jest.fn();
    const setOcrUploadProgress = jest.fn();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });
    mockUploadBusinessImage.mockRejectedValueOnce({
      code: 'UPLOAD_ABORTED',
      message: '上传中断，请在更稳定的网络下重试',
    });
    const { result } = renderHook(() => useDetailActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
      ocrResult: { date: 'stale', items: [{ mark: 'OLD', orderNo: 'OLD-01', amount: 1 }] },
      savedImagePath: { path: '/stale.png', name: 'stale.png' },
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'detail.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setOcrResult).toHaveBeenCalledWith(null);
    expect(setSavedImagePath).toHaveBeenCalledWith(null);
    expect(setOcrUploadStatus).toHaveBeenCalledWith('failed');
    expect(setOcrUploadMessage).toHaveBeenLastCalledWith('上传中断，请在更稳定的网络下重试');
    expect(setOcrUploadProgress).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenCalledWith('上传中断，请在更稳定的网络下重试');
    expect(result.current.uploading).toBe(false);
  });

  it('retries OCR recognition in the same dialog after a failed attempt and succeeds on the second upload', async () => {
    const firstFile = new File(['detail-1'], 'detail-1.png', { type: 'image/png' });
    const secondFile = new File(['detail-2'], 'detail-2.png', { type: 'image/png' });
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        data: {
          imageCompressionEnabled: true,
          imageCompressionQualityFloor: 0.3,
          ocrTargetMaxKb: 500,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          imageCompressionEnabled: false,
          imageCompressionQualityFloor: 0.45,
          ocrTargetMaxKb: 640,
        },
      });
    mockUploadBusinessImage
      .mockRejectedValueOnce({
        code: 'UPLOAD_ABORTED',
        message: '上传中断，请在更稳定的网络下重试',
      })
      .mockImplementationOnce(async (options) => {
        options.onStageChange?.({ stage: 'uploading', progress: 42, compressed: false, preparedFile: secondFile });
        options.onStageChange?.({ stage: 'saving', progress: 100, compressed: false, preparedFile: secondFile });
        return {
          prepared: {
            file: secondFile,
            compressed: false,
            qualityUsed: null,
            originalSize: secondFile.size,
            outputSize: secondFile.size,
            targetMaxBytes: 640 * 1024,
          },
          response: {
            success: true,
            data: {
              ocrResult: { date: '2026-03-12', items: [{ mark: 'RETRY', orderNo: 'RETRY-01', amount: 66 }] },
              image: { path: '/uploads/retry-success.png', name: 'retry-success.png' },
            },
          },
        };
      });

    const { result, history } = renderStatefulDetailActions();

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [firstFile], value: 'detail-1.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.error).toBe('上传中断，请在更稳定的网络下重试');
    expect(result.current.ocrUploadStatus).toBe('failed');
    expect(result.current.ocrUploadMessage).toBe('上传中断，请在更稳定的网络下重试');
    expect(result.current.ocrUploadProgress).toBeNull();
    expect(result.current.ocrResult).toBeNull();
    expect(result.current.savedImagePath).toBeNull();
    expect(result.current.selectedFile).toBe(firstFile);

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [secondFile], value: 'detail-2.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockUploadBusinessImage).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.ocrUploadStatus).toBe('success');
    expect(result.current.ocrUploadMessage).toBe('AI识别完成');
    expect(result.current.ocrUploadProgress).toBe(100);
    expect(result.current.ocrResult).toEqual({ date: '2026-03-12', items: [{ mark: 'RETRY', orderNo: 'RETRY-01', amount: 66 }] });
    expect(result.current.savedImagePath).toEqual({ path: '/uploads/retry-success.png', name: 'retry-success.png' });
    expect(result.current.selectedFile).toBe(secondFile);
    expect(history.errorHistory).toEqual([null, '上传中断，请在更稳定的网络下重试', null]);
    expect(history.ocrUploadStatusHistory).toEqual([
      'compressing',
      'failed',
      'compressing',
      'uploading',
      'saving',
      'success',
    ]);
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
