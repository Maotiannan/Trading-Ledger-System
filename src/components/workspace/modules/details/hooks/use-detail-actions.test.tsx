import { act, renderHook } from '@testing-library/react';
import { useDetailActions } from './use-detail-actions';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('useDetailActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const loadDetails = jest.fn(async () => undefined);
  const setOcrResult = jest.fn();
  const setImagePreview = jest.fn();
  const setSelectedFile = jest.fn();
  const setError = jest.fn();
  const setSavedImagePath = jest.fn();
  const handleShowUploadChange = jest.fn();
  const handleShowDirectCreateChange = jest.fn();
  const resetDirectForm = jest.fn();

  beforeEach(() => {
    mockApiCall.mockReset();
    loadDetails.mockClear();
    setError.mockClear();
    handleShowDirectCreateChange.mockClear();
    resetDirectForm.mockClear();
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
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
});
