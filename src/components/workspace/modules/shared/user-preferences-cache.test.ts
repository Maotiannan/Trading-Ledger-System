import { apiCall } from '@/components/workspace/shared';
import {
  clearClientUserPreferences,
  loadClientUserPreferences,
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
