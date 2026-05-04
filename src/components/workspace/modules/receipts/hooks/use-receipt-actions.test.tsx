import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useReceiptActions } from './use-receipt-actions';
import { apiCall, apiUploadCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import { uploadBusinessImage } from '@/components/workspace/modules/shared/business-image-upload';
import { compressReceiptDirectImage } from '../utils/image-compression';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  apiUploadCall: jest.fn(),
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

jest.mock('../utils/image-compression', () => ({
  compressReceiptDirectImage: jest.fn(async (file: File) => ({
    file,
    compressed: false,
    qualityUsed: null,
  })),
}));

const mockApiCall = apiCall as jest.Mock;
const mockApiUploadCall = apiUploadCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;
const mockUploadBusinessImage = uploadBusinessImage as jest.Mock;
const mockCompressReceiptDirectImage = compressReceiptDirectImage as jest.Mock;

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
  const setPendingDirectImageSelection = jest.fn();
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
    mockApiUploadCall.mockReset();
    mockGetApiErrorMessage.mockClear();
    mockGetErrorMessage.mockClear();
    mockUploadBusinessImage.mockReset();
    mockCompressReceiptDirectImage.mockClear();
    mockCompressReceiptDirectImage.mockResolvedValue({
      file: null,
      compressed: false,
      qualityUsed: null,
    });
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
    setPendingDirectImageSelection.mockClear();
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
    jest.useRealTimers();
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
      directSavedImagePath: null,
      pendingDirectImageSelection: null,
      setDirectSavedImagePath: jest.fn(),
      setDirectUploadedImageName: jest.fn(),
      setPendingDirectImageSelection,
      setOcrUploadStatus: jest.fn(),
      setOcrUploadMessage: jest.fn(),
      setOcrUploadProgress: jest.fn(),
      setDirectUploadStatus: jest.fn(),
      setDirectUploadMessage: jest.fn(),
      setDirectUploadProgress: jest.fn(),
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

  function renderStatefulReceiptActions(overrides: Partial<Parameters<typeof useReceiptActions>[0]> = {}) {
    const errorHistory: Array<string | null> = [];
    const ocrUploadStatusHistory: Array<'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed'> = [];
    const ocrUploadMessageHistory: Array<string | null> = [];
    const ocrUploadProgressHistory: Array<number | null> = [];

    const hook = renderHook(() => {
      const [selectedFile, setSelectedFile] = useState<File | null>(null);
      const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
      const [ocrCustomerMark, setOcrCustomerMark] = useState('');
      const [ocrCustomerName, setOcrCustomerName] = useState('');
      const [ocrCustomerId, setOcrCustomerId] = useState('');
      const [ocrCustomerCandidates, setOcrCustomerCandidates] = useState<Array<{
        id: string;
        mark: string;
        orderName: string;
        displayName: string;
        phone: string | null;
        city: string | null;
      }>>([]);
      const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
      const [imagePreview, setImagePreview] = useState<string | null>(null);
      const [ocrUploadStatus, setOcrUploadStatus] = useState<'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed'>('idle');
      const [ocrUploadMessage, setOcrUploadMessage] = useState<string | null>(null);
      const [ocrUploadProgress, setOcrUploadProgress] = useState<number | null>(null);
      const [error, setErrorState] = useState<string | null>(null);

      const actions = useReceiptActions(createDeps({
        ...overrides,
        selectedFile,
        ocrResult,
        ocrCustomerMark,
        ocrCustomerName,
        ocrCustomerId,
        savedImagePath,
        setSelectedFile,
        setOcrResult,
        setOcrCustomerMark,
        setOcrCustomerName,
        setOcrCustomerId,
        setOcrCustomerCandidates,
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
        ocrCustomerMark,
        ocrCustomerName,
        ocrCustomerId,
        ocrCustomerCandidates,
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
      const response = {
        success: true,
        data: {
          ocrResult: { receiptNo: 'OCR-1' },
          image: { path: '/uploads/receipt.png', name: 'receipt.png' },
        },
      };
      options.onStageChange?.({
        stage: 'success',
        progress: 100,
        compressed: true,
        preparedFile: file,
        response,
      });
      return {
        prepared: {
          file,
          compressed: true,
          qualityUsed: 0.72,
          originalSize: file.size,
          outputSize: file.size,
          targetMaxBytes: 640 * 1024,
        },
        response,
      };
    });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(mockApiCall).toHaveBeenCalledWith('settings?view=user-preferences');
    expect(mockUploadBusinessImage).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'receipt',
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
    expect(setOcrResult).toHaveBeenCalledWith({ receiptNo: 'OCR-1' });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/receipt.png', name: 'receipt.png' });
    expect(setOcrCustomerMark).toHaveBeenCalledWith('');
    expect(setOcrCustomerCandidates).toHaveBeenCalledWith([]);
    expect(result.current.uploading).toBe(false);
  });

  it('continues OCR upload with default compression behavior when loading preferences fails', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
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
          ocrResult: { receiptNo: 'OCR-FALLBACK' },
          image: { path: '/uploads/receipt-fallback.png', name: 'receipt-fallback.png' },
        },
      },
    });
    const { result } = renderHook(() => useReceiptActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockUploadBusinessImage).toHaveBeenCalledTimes(1);
    expect(mockUploadBusinessImage).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'receipt',
      compression: expect.objectContaining({
        preference: undefined,
      }),
    }));
    expect(setOcrResult).toHaveBeenCalledWith({ receiptNo: 'OCR-FALLBACK' });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/receipt-fallback.png', name: 'receipt-fallback.png' });
    expect(setOcrUploadStatus).toHaveBeenLastCalledWith('success');
    expect(setOcrUploadProgress).toHaveBeenLastCalledWith(100);
    expect(setError).not.toHaveBeenCalledWith('failed to fetch preferences');
    expect(result.current.uploading).toBe(false);
  });

  it('falls back to default compression settings when loading preferences stalls', async () => {
    jest.useFakeTimers();

    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockApiCall.mockImplementationOnce(() => new Promise(() => undefined));
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
          ocrResult: { receiptNo: 'OCR-STALL' },
          image: { path: '/uploads/receipt-stall.png', name: 'receipt-stall.png' },
        },
      },
    });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      void result.current.handleFileSelect({
        target: { files: [file], value: 'receipt.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
      await Promise.resolve();
    });

    expect(mockUploadBusinessImage).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    expect(mockUploadBusinessImage).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'receipt',
      compression: expect.objectContaining({
        preference: undefined,
      }),
    }));
    expect(setOcrResult).toHaveBeenCalledWith({ receiptNo: 'OCR-STALL' });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/receipt-stall.png', name: 'receipt-stall.png' });
    expect(result.current.uploading).toBe(false);
  });

  it('clears OCR upload state and surfaces mapped upload errors after OCR upload aborts', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
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
    const { result } = renderHook(() => useReceiptActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
      ocrResult: { receiptNo: 'STALE' },
      savedImagePath: { path: '/stale.png', name: 'stale.png' },
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
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

  it('treats malformed OCR success payloads as retryable failures even after upload success stage', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });
    mockUploadBusinessImage.mockImplementationOnce(async (options) => {
      options.onStageChange?.({ stage: 'uploading', progress: 42, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'saving', progress: 100, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'success', progress: 100, compressed: false, preparedFile: file });
      return {
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
            ocrResult: null,
            image: { path: '/uploads/malformed-receipt.png', name: 'malformed-receipt.png' },
          },
        },
      };
    });

    const { result, history } = renderStatefulReceiptActions({
      ocrResult: { receiptNo: 'STALE' },
      savedImagePath: { path: '/stale.png', name: 'stale.png' },
    });

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'receipt.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.error).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadStatus).toBe('failed');
    expect(result.current.ocrUploadMessage).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadProgress).toBeNull();
    expect(result.current.ocrResult).toBeNull();
    expect(result.current.savedImagePath).toBeNull();
    expect(result.current.selectedFile).toBe(file);
    expect(history.ocrUploadStatusHistory).toEqual([
      'compressing',
      'uploading',
      'saving',
      'success',
      'failed',
    ]);
  });

  it('accepts contract-valid partial OCR payloads', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });
    mockUploadBusinessImage.mockImplementationOnce(async (options) => {
      options.onStageChange?.({ stage: 'uploading', progress: 42, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'saving', progress: 100, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'success', progress: 100, compressed: false, preparedFile: file });
      return {
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
            ocrResult: { receiptNo: 'OCR-1', usd: null },
            image: { path: '/uploads/partial-receipt.png', name: 'partial-receipt.png' },
          },
        },
      };
    });

    const { result, history } = renderStatefulReceiptActions();

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'receipt.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.ocrUploadStatus).toBe('success');
    expect(result.current.ocrUploadMessage).toBe('AI识别完成');
    expect(result.current.ocrUploadProgress).toBe(100);
    expect(result.current.ocrResult).toEqual({ receiptNo: 'OCR-1', usd: null });
    expect(result.current.savedImagePath).toEqual({ path: '/uploads/partial-receipt.png', name: 'partial-receipt.png' });
    expect(history.ocrUploadStatusHistory).toEqual([
      'compressing',
      'uploading',
      'saving',
      'success',
      'success',
    ]);
  });

  it('treats empty OCR objects as retryable failures', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });
    mockUploadBusinessImage.mockImplementationOnce(async (options) => {
      options.onStageChange?.({ stage: 'uploading', progress: 42, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'saving', progress: 100, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'success', progress: 100, compressed: false, preparedFile: file });
      return {
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
            ocrResult: {},
            image: { path: '/uploads/empty-receipt.png', name: 'empty-receipt.png' },
          },
        },
      };
    });

    const { result, history } = renderStatefulReceiptActions({
      ocrResult: { receiptNo: 'STALE' },
      savedImagePath: { path: '/stale.png', name: 'stale.png' },
    });

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'receipt.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.error).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadStatus).toBe('failed');
    expect(result.current.ocrUploadMessage).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadProgress).toBeNull();
    expect(result.current.ocrResult).toBeNull();
    expect(result.current.savedImagePath).toBeNull();
    expect(result.current.selectedFile).toBe(file);
    expect(history.ocrUploadStatusHistory).toEqual([
      'compressing',
      'uploading',
      'saving',
      'success',
      'failed',
    ]);
  });

  it('treats semantically empty OCR payloads as retryable failures', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        imageCompressionEnabled: true,
        imageCompressionQualityFloor: 0.3,
        ocrTargetMaxKb: 500,
      },
    });
    mockUploadBusinessImage.mockImplementationOnce(async (options) => {
      options.onStageChange?.({ stage: 'uploading', progress: 42, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'saving', progress: 100, compressed: false, preparedFile: file });
      options.onStageChange?.({ stage: 'success', progress: 100, compressed: false, preparedFile: file });
      return {
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
            ocrResult: {
              receiptNo: null,
              date: null,
              tel: null,
              usd: null,
              orderNo: null,
              invNo: null,
              payer: null,
              isDeposit: false,
            },
            image: { path: '/uploads/semantically-empty-receipt.png', name: 'semantically-empty-receipt.png' },
          },
        },
      };
    });

    const { result, history } = renderStatefulReceiptActions({
      ocrResult: { receiptNo: 'STALE' },
      savedImagePath: { path: '/stale.png', name: 'stale.png' },
    });

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file], value: 'receipt.png' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.error).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadStatus).toBe('failed');
    expect(result.current.ocrUploadMessage).toBe('AI识别结果无效，请重试');
    expect(result.current.ocrUploadProgress).toBeNull();
    expect(result.current.ocrResult).toBeNull();
    expect(result.current.savedImagePath).toBeNull();
    expect(result.current.selectedFile).toBe(file);
    expect(history.ocrUploadStatusHistory).toEqual([
      'compressing',
      'uploading',
      'saving',
      'success',
      'failed',
    ]);
  });

  it('retries OCR recognition in the same dialog after a failed attempt and succeeds on the second upload', async () => {
    const firstFile = new File(['receipt-1'], 'receipt-1.png', { type: 'image/png' });
    const secondFile = new File(['receipt-2'], 'receipt-2.png', { type: 'image/png' });
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
              ocrResult: { receiptNo: 'OCR-RETRY-SUCCESS' },
              image: { path: '/uploads/retry-success.png', name: 'retry-success.png' },
            },
          },
        };
      });

    const { result, history } = renderStatefulReceiptActions();

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [firstFile] },
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
        target: { files: [secondFile] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockUploadBusinessImage).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.ocrUploadStatus).toBe('success');
    expect(result.current.ocrUploadMessage).toBe('AI识别完成');
    expect(result.current.ocrUploadProgress).toBe(100);
    expect(result.current.ocrResult).toEqual({ receiptNo: 'OCR-RETRY-SUCCESS' });
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

  it('blocks OCR confirmation when customer mark is empty', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    const { result } = renderHook(() => useReceiptActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 120 },
      ocrCustomerMark: '   ',
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('客户MARK不能为空');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces OCR confirmation failure when confirm API returns success=false', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: false, error: '创建失败，请重试' }),
    });
    const { result } = renderHook(() => useReceiptActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 120 },
      ocrCustomerMark: 'MAB-1',
      savedImagePath: { path: '/uploads/receipt.png', name: 'receipt.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('创建失败，请重试');
  });

  it('surfaces OCR confirmation network failure when confirm request throws', async () => {
    const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
    mockFetch.mockRejectedValue(new Error('confirm failed'));
    const { result } = renderHook(() => useReceiptActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 120 },
      ocrCustomerMark: 'MAB-1',
      savedImagePath: { path: '/uploads/receipt.png', name: 'receipt.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('confirm failed');
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
        imagePath: null,
        imageName: null,
      }),
    }));
    expect(handleShowDirectCreateChange).toHaveBeenCalledWith(false);
    expect(resetDirectForm).toHaveBeenCalled();
    expect(loadReceipts).toHaveBeenCalled();
  });

  it('prepares direct-create receipt image for local confirmation before uploading', async () => {
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectImageSelect({
        target: { files: [file], value: 'fake' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setPendingDirectImageSelection).toHaveBeenCalledWith({
      file,
      previewUrl: 'data:image/png;base64,mock',
      name: 'direct-receipt.png',
    });
    expect(mockApiUploadCall).not.toHaveBeenCalled();
  });

  it('surfaces preview-read failure before direct-create image upload confirmation', async () => {
    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL(_file: Blob) {
        if (this.onerror) {
          this.onerror.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
        }
      }
    }

    global.FileReader = FailingFileReader as unknown as typeof FileReader;
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectImageSelect({
        target: { files: [file], value: 'fake' },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setPendingDirectImageSelection).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith('图片预览读取失败，请重试');
  });

  it('uploads confirmed direct-create receipt image and stores returned path', async () => {
    const setDirectSavedImagePath = jest.fn();
    const setDirectUploadedImageName = jest.fn();
    const setDirectUploadStatus = jest.fn();
    const setDirectUploadMessage = jest.fn();
    const setDirectUploadProgress = jest.fn();
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    mockCompressReceiptDirectImage.mockResolvedValue({
      file,
      compressed: false,
      qualityUsed: null,
    });
    mockApiUploadCall.mockImplementation(async (_endpoint, _formData, options) => {
      options?.onUploadProgress?.({ loaded: 50, total: 100, percent: 50 });
      options?.onUploadStageChange?.('saving');
      return {
        success: true,
        data: {
          path: '/upload/images/receipts/direct/direct-receipt.png',
          name: 'direct-receipt.png',
        },
      };
    });

    const { result } = renderHook(() => useReceiptActions(createDeps({
      setDirectSavedImagePath,
      setDirectUploadedImageName,
      pendingDirectImageSelection: {
        file,
        previewUrl: 'data:image/png;base64,mock',
        name: 'direct-receipt.png',
      },
      setPendingDirectImageSelection,
      setDirectUploadStatus,
      setDirectUploadMessage,
      setDirectUploadProgress,
    })));

    await act(async () => {
      await result.current.handleConfirmDirectImageUpload();
    });

    expect(mockApiUploadCall).toHaveBeenCalledWith('upload-image', expect.any(FormData), expect.objectContaining({
      method: 'POST',
    }));
    const [, formData] = mockApiUploadCall.mock.calls[0] as [string, FormData];
    expect(formData.get('action')).toBe('upload');
    expect(formData.get('category')).toBe('receipt-direct');
    expect(setDirectSavedImagePath).toHaveBeenCalledWith({
      path: '/upload/images/receipts/direct/direct-receipt.png',
      name: 'direct-receipt.png',
    });
    expect(setDirectUploadedImageName).toHaveBeenCalledWith('direct-receipt.png');
    expect(setPendingDirectImageSelection).toHaveBeenCalledWith(null);
    expect(setDirectUploadProgress).toHaveBeenCalledWith(50);
    expect(setDirectUploadProgress).toHaveBeenCalledWith(100);
    expect(setDirectUploadStatus).toHaveBeenCalledWith('saving');
    expect(setDirectUploadStatus).toHaveBeenCalledWith('success');
  });

  it('sends uploaded direct-create image path with receipt payload', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useReceiptActions(createDeps({
      directSavedImagePath: {
        path: '/upload/images/receipts/direct/direct-receipt.png',
        name: 'direct-receipt.png',
      },
    })));

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
        imagePath: '/upload/images/receipts/direct/direct-receipt.png',
        imageName: 'direct-receipt.png',
      }),
    }));
  });

  it('reports direct-create image upload failure returned by API', async () => {
    const setDirectSavedImagePath = jest.fn();
    const setDirectUploadedImageName = jest.fn();
    const setDirectUploadStatus = jest.fn();
    const setDirectUploadMessage = jest.fn();
    const setDirectUploadProgress = jest.fn();
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    mockCompressReceiptDirectImage.mockResolvedValue({
      file,
      compressed: false,
      qualityUsed: null,
    });
    mockApiUploadCall.mockResolvedValue({ success: false, error: '上传失败' });

    const { result } = renderHook(() => useReceiptActions(createDeps({
      setDirectSavedImagePath,
      setDirectUploadedImageName,
      pendingDirectImageSelection: {
        file,
        previewUrl: 'data:image/png;base64,mock',
        name: 'direct-receipt.png',
      },
      setDirectUploadStatus,
      setDirectUploadMessage,
      setDirectUploadProgress,
    })));

    await act(async () => {
      await result.current.handleConfirmDirectImageUpload();
    });

    expect(setDirectSavedImagePath).toHaveBeenCalledWith(null);
    expect(setDirectUploadedImageName).toHaveBeenCalledWith('');
    expect(setDirectUploadStatus).toHaveBeenCalledWith('failed');
    expect(setDirectUploadProgress).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenCalledWith('上传失败');
  });

  it('maps interrupted direct-create image uploads to a visible retry message', async () => {
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    const setDirectUploadStatus = jest.fn();
    const setDirectUploadMessage = jest.fn();
    const setDirectUploadProgress = jest.fn();
    mockCompressReceiptDirectImage.mockResolvedValue({
      file,
      compressed: true,
      qualityUsed: 0.62,
    });
    mockApiUploadCall.mockRejectedValue({
      code: 'UPLOAD_ABORTED',
      message: '上传中断，请在更稳定的网络下重试',
    });

    const { result } = renderHook(() => useReceiptActions(createDeps({
      pendingDirectImageSelection: {
        file,
        previewUrl: 'data:image/png;base64,mock',
        name: 'direct-receipt.png',
      },
      setDirectUploadStatus,
      setDirectUploadMessage,
      setDirectUploadProgress,
    })));

    await act(async () => {
      await result.current.handleConfirmDirectImageUpload();
    });

    expect(setDirectUploadStatus).toHaveBeenCalledWith('compressing');
    expect(setDirectUploadStatus).toHaveBeenCalledWith('uploading');
    expect(setDirectUploadStatus).toHaveBeenCalledWith('failed');
    expect(setDirectUploadMessage).toHaveBeenLastCalledWith('上传中断，请在更稳定的网络下重试');
    expect(setDirectUploadProgress).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenCalledWith('上传中断，请在更稳定的网络下重试');
  });

  it('surfaces direct-create image compression failure before upload', async () => {
    const file = new File(['receipt'], 'direct-receipt.png', { type: 'image/png' });
    const setDirectSavedImagePath = jest.fn();
    const setDirectUploadedImageName = jest.fn();
    const setDirectUploadStatus = jest.fn();
    const setDirectUploadMessage = jest.fn();
    const setDirectUploadProgress = jest.fn();
    mockCompressReceiptDirectImage.mockRejectedValue(new Error('图片压缩失败，请重试'));

    const { result } = renderHook(() => useReceiptActions(createDeps({
      pendingDirectImageSelection: {
        file,
        previewUrl: 'data:image/png;base64,mock',
        name: 'direct-receipt.png',
      },
      setDirectSavedImagePath,
      setDirectUploadedImageName,
      setDirectUploadStatus,
      setDirectUploadMessage,
      setDirectUploadProgress,
    })));

    await act(async () => {
      await result.current.handleConfirmDirectImageUpload();
    });

    expect(setDirectSavedImagePath).toHaveBeenCalledWith(null);
    expect(setDirectUploadedImageName).toHaveBeenCalledWith('');
    expect(setDirectUploadStatus).toHaveBeenCalledWith('failed');
    expect(setDirectUploadMessage).toHaveBeenLastCalledWith('图片压缩失败，请重试');
    expect(setDirectUploadProgress).toHaveBeenLastCalledWith(null);
    expect(setError).toHaveBeenCalledWith('图片压缩失败，请重试');
  });

  it('reports direct-create failure returned by API', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '创建失败' });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('创建失败');
  });

  it('surfaces mark-received network failure', async () => {
    mockFetch.mockRejectedValue(new Error('mark received failed'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleMarkReceived('receipt-1');
    });

    expect(alertSpy).toHaveBeenCalledWith('mark received failed');
  });

  it('reports direct-create failure when request throws', async () => {
    mockApiCall.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('network down');
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

  it('shows alert when receipt deletion request fails', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '申请失败' });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteReceipt('receipt-1');
    });

    expect(window.alert).toHaveBeenCalledWith('申请失败');
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

  it('shows alert when mark-received fails', async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: false, error: '操作失败' }),
    });
    const { result } = renderHook(() => useReceiptActions(createDeps()));

    await act(async () => {
      await result.current.handleMarkReceived('receipt-2');
    });

    expect(window.alert).toHaveBeenCalledWith('操作失败');
  });
});
