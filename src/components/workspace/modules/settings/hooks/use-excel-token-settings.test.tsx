import { act, renderHook } from '@testing-library/react';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import { useExcelTokenSettings } from './use-excel-token-settings';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => {
    if (error instanceof Error) return error.message;
    return fallback;
  }),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;

describe('useExcelTokenSettings', () => {
  const tx = (zh: string, _en: string) => zh;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads token metadata without exposing token hashes', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'token-1',
          name: 'Excel ML',
          tokenPrefix: 'prefix123',
          createdAt: '2026-04-28T08:00:00.000Z',
          updatedAt: '2026-04-28T08:00:00.000Z',
          lastUsedAt: null,
          lastUsedIp: null,
          revokedAt: null,
          expiresAt: null,
          tokenHash: 'hidden',
        },
      ],
    });

    const { result } = renderHook(() => useExcelTokenSettings(tx));

    await act(async () => {
      await result.current.loadExcelTokens();
    });

    expect(mockApiCall).toHaveBeenCalledWith('excel/token');
    expect(result.current.excelTokens).toEqual([
      expect.not.objectContaining({ tokenHash: expect.anything() }),
    ]);
    expect(result.current.excelTokens[0]).toEqual(expect.objectContaining({
      id: 'token-1',
      tokenPrefix: 'prefix123',
    }));
  });

  it('generates a one-time token then refreshes token metadata', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        message: 'Excel API令牌已生成',
        data: {
          token: 'ml_prefix_secret',
          tokenInfo: {
            id: 'token-1',
            name: 'Excel ML',
            tokenPrefix: 'prefix',
            createdAt: '2026-04-28T08:00:00.000Z',
            updatedAt: '2026-04-28T08:00:00.000Z',
            lastUsedAt: null,
            lastUsedIp: null,
            revokedAt: null,
            expiresAt: null,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'token-1', name: 'Excel ML', tokenPrefix: 'prefix', createdAt: '', updatedAt: '', lastUsedAt: null, lastUsedIp: null, revokedAt: null, expiresAt: null }],
      });

    const { result } = renderHook(() => useExcelTokenSettings(tx));

    await act(async () => {
      await result.current.generateExcelToken();
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'excel/token', {
      method: 'POST',
      body: JSON.stringify({ action: 'generate', name: 'Excel ML' }),
    });
    expect(mockApiCall).toHaveBeenNthCalledWith(2, 'excel/token');
    expect(result.current.oneTimeExcelToken).toBe('ml_prefix_secret');
    expect(result.current.excelTokenMessage).toBe('Excel API令牌已生成');
  });

  it('revokes a token and clears the one-time token display', async () => {
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        message: 'Excel API令牌已撤销',
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'token-1', name: 'Excel ML', tokenPrefix: 'prefix', createdAt: '', updatedAt: '', lastUsedAt: null, lastUsedIp: null, revokedAt: '2026-04-28T09:00:00.000Z', expiresAt: null }],
      });

    const { result } = renderHook(() => useExcelTokenSettings(tx));

    await act(async () => {
      await result.current.revokeExcelToken('token-1');
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'excel/token', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke', id: 'token-1' }),
    });
    expect(result.current.oneTimeExcelToken).toBeNull();
    expect(result.current.excelTokenMessage).toBe('Excel API令牌已撤销');
  });

  it('surfaces load failures through the shared error mapper', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('network failed'));

    const { result } = renderHook(() => useExcelTokenSettings(tx));

    await act(async () => {
      await result.current.loadExcelTokens();
    });

    expect(mockGetApiErrorMessage).toHaveBeenCalled();
    expect(result.current.excelTokenError).toBe('network failed');
  });
});
