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
  const loadSwifts = jest.fn(async () => undefined);
  const setOcrResult = jest.fn();
  const setImagePreview = jest.fn();
  const setSelectedFile = jest.fn();
  const setSavedImagePath = jest.fn();
  const setError = jest.fn();
  const handleShowUploadChange = jest.fn();
  const handleShowDirectCreateChange = jest.fn();
  const resetDirectForm = jest.fn();

  beforeEach(() => {
    mockApiCall.mockReset();
    loadSwifts.mockClear();
    setError.mockClear();
    handleShowDirectCreateChange.mockClear();
    resetDirectForm.mockClear();
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
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
});
