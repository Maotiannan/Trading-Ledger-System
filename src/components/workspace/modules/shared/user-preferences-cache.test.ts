import { apiCall } from '@/components/workspace/shared';
import {
  clearClientUserPreferences,
  loadClientUserPreferences,
  initializeClientUserPreferences,
  readClientUserPreferences,
  rememberClientUserPreferences,
} from './user-preferences-cache';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;

describe('user preference request coordination', () => {
  beforeEach(() => {
    clearClientUserPreferences();
    jest.clearAllMocks();
  });

  it('has a verified account preference ready before the dashboard mounts', async () => {
    initializeClientUserPreferences('a', { dashboardLayout: null });
    expect(readClientUserPreferences('a')).not.toBeNull();
    await loadClientUserPreferences();
    expect(mockApiCall).not.toHaveBeenCalled();
    expect(readClientUserPreferences('b')).toBeNull();
  });

  it('does not replace saved preferences with defaults after a request failure', async () => {
    initializeClientUserPreferences('a');
    mockApiCall.mockResolvedValue({ success: false });
    await expect(loadClientUserPreferences()).rejects.toThrow();
    expect(readClientUserPreferences('a')).toBeNull();
  });

  it('discards an old account request resolving after account switch', async () => {
    initializeClientUserPreferences('a');
    let resolve: (value: unknown) => void = () => undefined;
    mockApiCall.mockReturnValue(new Promise((done) => { resolve = done; }));
    const old = loadClientUserPreferences();
    initializeClientUserPreferences('b', { listPageSizes: { receipt: 50 } });
    resolve({ success: true, data: { listPageSizes: { receipt: 5 } } });
    await expect(old).rejects.toThrow();
    expect(readClientUserPreferences('b')?.listPageSizes.receipt).toBe(50);
  });

  it('updates the account snapshot immediately after settings save', () => {
    initializeClientUserPreferences('a', {});
    rememberClientUserPreferences({ listPageSizes: { receipt: 50 } });
    expect(readClientUserPreferences('a')?.listPageSizes.receipt).toBe(50);
  });

  it('shares one in-flight request between dashboard preference consumers', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    mockApiCall.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const first = loadClientUserPreferences();
    const second = loadClientUserPreferences();

    expect(mockApiCall).toHaveBeenCalledTimes(1);
    resolveRequest?.({
      success: true,
      data: {
        dashboardLayout: null,
        listPageSizes: { customerHistoryOrders: 15 },
      },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ listPageSizes: expect.objectContaining({ customerHistoryOrders: 15 }) }),
      expect.objectContaining({ listPageSizes: expect.objectContaining({ customerHistoryOrders: 15 }) }),
    ]);
  });
});
