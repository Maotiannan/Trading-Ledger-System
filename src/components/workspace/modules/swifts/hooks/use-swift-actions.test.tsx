import { act, renderHook } from '@testing-library/react';
import { useSwiftActions } from './use-swift-actions';
import { apiCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import { uploadBusinessImage } from '@/components/workspace/modules/shared/business-image-upload';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
}));

jest.mock('@/components/workspace/modules/shared/business-image-upload', () => ({
  uploadBusinessImage: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;
const mockUploadBusinessImage = uploadBusinessImage as jest.Mock;

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
    mockApiCall.mockResolvedValue({ success: true, data: null });
    mockGetApiErrorMessage.mockClear();
    mockUploadBusinessImage.mockReset();
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
      setOcrUploadStatus: jest.fn(),
      setOcrUploadMessage: jest.fn(),
      setOcrUploadProgress: jest.fn(),
      handleShowUploadChange,
      handleShowDirectCreateChange,
      resetDirectForm,
      ...overrides,
    };
  }

  it('recognizes uploaded swift image', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockUploadBusinessImage.mockResolvedValue({
      response: {
        success: true,
        data: {
          ocrResult: {
            amount: 330,
            senderName: 'SALAM ENTERPRISE',
            senderAddress: 'ADDRESS LINE1',
            receiverName: 'MARKET UNION CO LTD',
            receiverAccount: '76881488000007249',
          },
          image: { path: '/uploads/swift.png', name: 'swift.png' },
        },
      },
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSelectedFile).toHaveBeenCalledWith(file);
    expect(setImagePreview).toHaveBeenCalledWith('data:image/png;base64,mock');
    expect(setOcrResult).toHaveBeenCalledWith({
      amount: 330,
      senderName: 'SALAM ENTERPRISE',
      senderAddress: 'ADDRESS LINE1',
      receiverName: 'MARKET UNION CO LTD',
      receiverAccount: '76881488000007249',
    });
    expect(setSavedImagePath).toHaveBeenCalledWith({ path: '/uploads/swift.png', name: 'swift.png' });
  });

  it('shows OCR failure returned by the server and clears saved image path', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockUploadBusinessImage.mockResolvedValue({
      response: { success: false, message: 'ocr failed' },
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSavedImagePath).toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenCalledWith('AI识别结果无效，请重试');
  });

  it('shows OCR network errors and clears saved image path', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockUploadBusinessImage.mockRejectedValue(new Error('fetch failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setSavedImagePath).toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenCalledWith('fetch failed');
  });

  it('uses shared upload stage messages and tolerates user-preference lookup failures', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    const setOcrUploadStatus = jest.fn();
    const setOcrUploadMessage = jest.fn();
    const setOcrUploadProgress = jest.fn();
    mockApiCall.mockRejectedValueOnce(new Error('settings unavailable'));
    mockUploadBusinessImage.mockImplementation(async (options) => {
      const formData = options.buildFormData(file);
      expect(formData.get('action')).toBe('recognize');
      expect(formData.get('file')).toBe(file);
      options.onStageChange({ stage: 'uploading', progress: 42, compressed: true });
      options.onStageChange({ stage: 'saving', progress: null, compressed: null });
      return {
        response: {
          success: true,
          data: {
            ocrResult: {
              amount: 51386,
              date: '2026-05-01',
              senderName: 'SALAM ENTERPRISE',
              senderAddress: 'ADDRESS LINE1',
              receiverName: 'MARKET UNION CO LTD',
              receiverAccount: '76881488000007249',
            },
            image: { path: '/uploads/swift.png', name: 'swift.png' },
          },
        },
      };
    });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setOcrUploadStatus).toHaveBeenCalledWith('compressing');
    expect(setOcrUploadStatus).toHaveBeenCalledWith('uploading');
    expect(setOcrUploadStatus).toHaveBeenCalledWith('saving');
    expect(setOcrUploadStatus).toHaveBeenCalledWith('success');
    expect(setOcrUploadMessage).toHaveBeenCalledWith('正在上传压缩后的图片（42%）...');
    expect(setOcrUploadMessage).toHaveBeenCalledWith('图片已上传，AI正在识别...');
    expect(setOcrUploadProgress).toHaveBeenCalledWith(42);
    expect(setOcrUploadProgress).toHaveBeenCalledWith(100);
  });

  it('passes persisted image compression preferences into the shared uploader', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: true,
        qualityFloor: 0.45,
        targetMaxKb: 480,
      },
    });
    mockUploadBusinessImage.mockImplementation(async (options) => {
      expect(options.compression.preference).toEqual({
        enabled: true,
        qualityFloor: 0.45,
        targetMaxKb: 480,
      });
      return {
        response: {
          success: true,
          data: {
            ocrResult: {
              amount: 51386,
              date: '2026-05-01',
              senderName: 'SALAM ENTERPRISE',
              senderAddress: 'ADDRESS LINE1',
              receiverName: 'MARKET UNION CO LTD',
              receiverAccount: '76881488000007249',
            },
            image: { path: '/uploads/swift.png', name: 'swift.png' },
          },
        },
      };
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockUploadBusinessImage).toHaveBeenCalled();
  });

  it('falls back after the user-preference soft timeout when settings never resolve', async () => {
    jest.useFakeTimers();
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockApiCall.mockReturnValue(new Promise(() => undefined));
    mockUploadBusinessImage.mockImplementation(async (options) => {
      expect(options.compression.preference).toBeUndefined();
      return {
        response: {
          success: true,
          data: {
            ocrResult: {
              amount: 51386,
              date: '2026-05-01',
              senderName: 'SALAM ENTERPRISE',
              senderAddress: 'ADDRESS LINE1',
              receiverName: 'MARKET UNION CO LTD',
              receiverAccount: '76881488000007249',
            },
            image: { path: '/uploads/swift.png', name: 'swift.png' },
          },
        },
      };
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    const pending = act(async () => {
      const work = result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
      jest.advanceTimersByTime(1_500);
      await work;
    });

    await pending;
    jest.useRealTimers();
    expect(mockUploadBusinessImage).toHaveBeenCalled();
  });

  it('maps failed upload stages through API error messages', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    const setOcrUploadStatus = jest.fn();
    const setOcrUploadMessage = jest.fn();
    const setOcrUploadProgress = jest.fn();
    mockUploadBusinessImage.mockImplementation(async (options) => {
      options.onStageChange({
        stage: 'failed',
        progress: null,
        compressed: null,
        error: new Error('upload interrupted'),
      });
      throw new Error('upload interrupted');
    });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      setOcrUploadStatus,
      setOcrUploadMessage,
      setOcrUploadProgress,
    })));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(mockGetApiErrorMessage).toHaveBeenCalled();
    expect(setOcrUploadStatus).toHaveBeenCalledWith('failed');
    expect(setOcrUploadMessage).toHaveBeenCalledWith('upload interrupted');
    expect(setOcrUploadProgress).toHaveBeenCalledWith(null);
  });

  it('rejects invalid OCR payload shapes before filling the form', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockUploadBusinessImage.mockResolvedValue({
      response: {
        success: true,
        data: {
          ocrResult: {
            amount: '51386',
            senderName: 'SALAM ENTERPRISE',
          },
          image: { path: '/uploads/swift.png', name: 'swift.png' },
        },
      },
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setError).toHaveBeenCalledWith('AI识别结果无效，请重试');
  });

  it('rejects missing OCR payload values before filling the form', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockUploadBusinessImage.mockResolvedValue({
      response: {
        success: true,
        data: {
          ocrResult: null,
          image: { path: '/uploads/swift.png', name: 'swift.png' },
        },
      },
    });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleFileSelect({
        target: { files: [file] },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(setError).toHaveBeenCalledWith('AI识别结果无效，请重试');
  });

  it('requires a linked detail before confirming OCR swift', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330, senderName: null, senderAddress: null, receiverName: null, receiverAccount: null, date: null },
      selectedDetailId: '',
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('请选择付款明细');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires a valid OCR amount before confirming OCR swift', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: null, senderName: null, senderAddress: null, receiverName: null, receiverAccount: null, date: null },
      selectedDetailId: 'detail-1',
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('请输入有效的汇款金额');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('confirms OCR swift creation and refreshes list', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true }),
    });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330, senderName: null, senderAddress: null, receiverName: null, receiverAccount: null, date: null },
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

  it('shows confirm-create business failures without closing the dialog', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: false, message: 'confirm failed' }),
    });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330, senderName: null, senderAddress: null, receiverName: null, receiverAccount: null, date: null },
      selectedDetailId: 'detail-1',
      savedImagePath: { path: '/uploads/swift.png', name: 'swift.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('创建失败，请重试');
    expect(handleShowUploadChange).not.toHaveBeenCalled();
  });

  it('shows confirm-create network errors without closing the dialog', async () => {
    const file = new File(['swift'], 'swift.png', { type: 'image/png' });
    mockFetch.mockRejectedValue(new Error('confirm fetch failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps({
      selectedFile: file,
      ocrResult: { amount: 330, senderName: null, senderAddress: null, receiverName: null, receiverAccount: null, date: null },
      selectedDetailId: 'detail-1',
      savedImagePath: { path: '/uploads/swift.png', name: 'swift.png' },
    })));

    await act(async () => {
      await result.current.handleConfirm();
    });

    expect(setError).toHaveBeenCalledWith('confirm fetch failed');
    expect(handleShowUploadChange).not.toHaveBeenCalled();
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

  it('surfaces direct-create business failures', async () => {
    mockApiCall.mockResolvedValue({ success: false, message: 'bad payload' });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDirectCreate();
    });

    expect(setError).toHaveBeenCalledWith('创建失败');
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

  it('alerts when direct deletion of erroneous swift returns a business failure payload', async () => {
    mockApiCall.mockResolvedValue({ success: false, message: 'cannot delete' });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-err',
        hasError: true,
      } as never);
    });

    expect(window.alert).toHaveBeenCalledWith('删除失败');
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

  it('alerts when normal swift deletion request fails', async () => {
    mockApiCall.mockResolvedValue({ success: false, message: 'delete request failed' });
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      await result.current.handleDeleteSwift({
        id: 'swift-ok',
        hasError: false,
      } as never);
    });

    expect(window.alert).toHaveBeenCalledWith('申请失败');
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

  it('submits direct swift edits for admins and approval requests for sales', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const loadSwiftEditRequests = jest.fn(async () => undefined);
    mockApiCall
      .mockResolvedValueOnce({ success: true, message: '修改已完成' })
      .mockResolvedValueOnce({ success: true, message: '成功提交，等待管理员同意' });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      loadSwiftEditRequests,
    }) as never));

    let adminOutcome: Awaited<ReturnType<typeof result.current.handleSubmitSwiftEdit>> | null = null;
    await act(async () => {
      adminOutcome = await result.current.handleSubmitSwiftEdit({
        swiftId: 'swift-1',
        data: {
          date: '2026-05-05',
          amount: 110,
          senderName: 'Admin Sender',
          senderAddress: 'Conakry',
          receiverName: 'Admin Receiver',
          receiverAccount: 'ACC-1',
        },
        isAdmin: true,
      });
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'swift', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'update',
        swiftId: 'swift-1',
        data: {
          date: '2026-05-05',
          amount: 110,
          senderName: 'Admin Sender',
          senderAddress: 'Conakry',
          receiverName: 'Admin Receiver',
          receiverAccount: 'ACC-1',
        },
      }),
    }));
    expect(adminOutcome).toEqual({ success: true, message: '修改已完成' });

    let salesOutcome: Awaited<ReturnType<typeof result.current.handleSubmitSwiftEdit>> | null = null;
    await act(async () => {
      salesOutcome = await result.current.handleSubmitSwiftEdit({
        swiftId: 'swift-1',
        data: {
          date: '2026-05-06',
          amount: 120,
          senderName: 'Sales Sender',
          senderAddress: 'Kindia',
          receiverName: 'Sales Receiver',
          receiverAccount: 'ACC-2',
        },
        isAdmin: false,
      });
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(2, 'swift', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'request-edit',
        swiftId: 'swift-1',
        data: {
          date: '2026-05-06',
          amount: 120,
          senderName: 'Sales Sender',
          senderAddress: 'Kindia',
          receiverName: 'Sales Receiver',
          receiverAccount: 'ACC-2',
        },
      }),
    }));
    expect(salesOutcome).toEqual({ success: true, message: '成功提交，等待管理员同意' });
    expect(loadSwifts).toHaveBeenCalledTimes(2);
    expect(loadSwiftEditRequests).toHaveBeenCalledTimes(2);
    expect(alertSpy).toHaveBeenCalledWith('修改已完成');
    expect(alertSpy).toHaveBeenCalledWith('成功提交，等待管理员同意');
  });

  it('reviews swift edit requests and reloads views', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    const loadSwiftEditRequests = jest.fn(async () => undefined);
    mockApiCall.mockResolvedValueOnce({ success: true, message: 'SWIFT修改申请已通过' });
    const { result } = renderHook(() => useSwiftActions(createDeps({
      loadSwiftEditRequests,
    }) as never));

    let reviewOutcome = false;
    await act(async () => {
      reviewOutcome = await result.current.handleReviewSwiftEdit({
        requestId: 'swift-request-1',
        decision: 'approve',
      });
    });

    expect(reviewOutcome).toBe(true);
    expect(mockApiCall).toHaveBeenCalledWith('swift', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'review-edit',
        requestId: 'swift-request-1',
        decision: 'approve',
      }),
    }));
    expect(alertSpy).toHaveBeenCalledWith('SWIFT修改申请已通过');
    expect(loadSwifts).toHaveBeenCalled();
    expect(loadSwiftEditRequests).toHaveBeenCalled();
  });

  it('surfaces swift edit submission failures and network errors', async () => {
    mockApiCall
      .mockResolvedValueOnce({ success: false, message: 'bad request' })
      .mockRejectedValueOnce(new Error('edit network failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      const failed = await result.current.handleSubmitSwiftEdit({
        swiftId: 'swift-1',
        data: {
          date: '2026-05-05',
          amount: 110,
          senderName: 'Admin Sender',
          senderAddress: 'Conakry',
          receiverName: 'Admin Receiver',
          receiverAccount: 'ACC-1',
        },
        isAdmin: true,
      });
      expect(failed).toEqual({ success: false, message: '修改失败，请重试' });
    });

    await act(async () => {
      const failed = await result.current.handleSubmitSwiftEdit({
        swiftId: 'swift-1',
        data: {
          date: '2026-05-05',
          amount: 110,
          senderName: 'Admin Sender',
          senderAddress: 'Conakry',
          receiverName: 'Admin Receiver',
          receiverAccount: 'ACC-1',
        },
        isAdmin: false,
      });
      expect(failed).toEqual({ success: false, message: 'edit network failed' });
    });

    expect(setError).toHaveBeenLastCalledWith('edit network failed');
  });

  it('surfaces swift edit review failures and network errors', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    mockApiCall
      .mockResolvedValueOnce({ success: false, message: 'review failed' })
      .mockRejectedValueOnce(new Error('review network failed'));
    const { result } = renderHook(() => useSwiftActions(createDeps()));

    await act(async () => {
      const failed = await result.current.handleReviewSwiftEdit({
        requestId: 'swift-request-1',
        decision: 'reject',
      });
      expect(failed).toBe(false);
    });

    await act(async () => {
      const failed = await result.current.handleReviewSwiftEdit({
        requestId: 'swift-request-1',
        decision: 'approve',
      });
      expect(failed).toBe(false);
    });

    expect(alertSpy).toHaveBeenCalledWith('审批失败，请重试');
    expect(alertSpy).toHaveBeenCalledWith('review network failed');
    expect(setError).toHaveBeenLastCalledWith('review network failed');
  });
});
