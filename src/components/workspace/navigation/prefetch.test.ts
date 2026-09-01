import { getWorkspaceDataPrefetches, prefetchWorkspaceView } from './prefetch';
import { prefetchApiResult } from '@/components/workspace/api/client';

jest.mock('@/components/workspace/api/client', () => ({
  prefetchApiResult: jest.fn(),
}));

const mockPrefetchApiResult = prefetchApiResult as jest.Mock;

describe('workspace email prefetch authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prefetches Email Management only for ADMIN', () => {
    const router = { prefetch: jest.fn() };

    prefetchWorkspaceView(router, 'emails', { isManager: true, isAdmin: false });
    expect(router.prefetch).not.toHaveBeenCalled();
    expect(mockPrefetchApiResult).not.toHaveBeenCalled();

    prefetchWorkspaceView(router, 'emails', { isManager: true, isAdmin: true });
    expect(router.prefetch).toHaveBeenCalledWith('/emails');
    expect(mockPrefetchApiResult).toHaveBeenCalledWith('email-notifications?page=1&pageSize=20');
    expect(getWorkspaceDataPrefetches('emails', { isAdmin: false })).toEqual([]);
  });
});
