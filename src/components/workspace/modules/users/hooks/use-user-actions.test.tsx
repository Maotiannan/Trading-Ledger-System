import { act, renderHook } from '@testing-library/react';
import { useUserActions } from './use-user-actions';
import { apiCall, getApiErrorMessage, getErrorMessage } from '@/components/workspace/shared';
import type { ManagedUserRole } from '../types';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getApiErrorMessage: jest.fn((error: unknown, fallback: string) => {
    if (error instanceof Error && error.message) return error.message;
    if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).error || fallback);
    }
    return fallback;
  }),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => {
    if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
      return String((error as Record<string, unknown>).error || fallback);
    }
    return error instanceof Error ? error.message : fallback;
  }),
}));

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;

describe('useUserActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const setUsers = jest.fn();
  const setShowCreate = jest.fn();
  let newUserState = { email: 'user@example.com', password: 'User@2026!', name: 'User', role: 'SALES' as const, parentId: '' };
  const setNewUser = jest.fn((value) => {
    newUserState = typeof value === 'function' ? value(newUserState) : value;
  });
  const setParentOptions = jest.fn();
  const setLoadingParents = jest.fn();

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetApiErrorMessage.mockClear();
    mockGetErrorMessage.mockClear();
    setUsers.mockClear();
    setShowCreate.mockClear();
    setNewUser.mockClear();
    setParentOptions.mockClear();
    setLoadingParents.mockClear();
    newUserState = { email: 'user@example.com', password: 'User@2026!', name: 'User', role: 'SALES', parentId: '' };
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
    jest.spyOn(window, 'prompt').mockImplementation(() => 'Reset@2026!');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createDeps(overrides: Partial<Parameters<typeof useUserActions>[0]> = {}) {
    return {
      tx,
      user: { id: 'sales-1', role: 'SALES' } as never,
      showCreate: true,
      newUser: newUserState,
      creatableRoles: ['USER'] as ManagedUserRole[],
      setUsers,
      setShowCreate,
      setNewUser,
      setParentOptions,
      setLoadingParents,
      ...overrides,
    };
  }

  it('loads parent options and defaults to current user when available', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: 'SALES', level: 3 },
        { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', level: 1 },
      ],
    });

    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.loadParentOptions('USER');
    });

    expect(setParentOptions).toHaveBeenCalled();
    expect(newUserState.parentId).toBe('sales-1');
  });

  it('forces sales-created account role to USER on create', async () => {
    mockApiCall.mockResolvedValueOnce({ success: true, message: '用户已创建' }).mockResolvedValueOnce({ success: true, data: [] });
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(mockApiCall).toHaveBeenNthCalledWith(1, 'auth', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        email: 'user@example.com',
        password: 'User@2026!',
        name: 'User',
        role: 'USER',
        parentId: undefined,
      }),
    }));
    expect(setShowCreate).toHaveBeenCalledWith(false);
    expect(window.alert).toHaveBeenCalledWith('用户已创建');
  });

  it('alerts when create fails with structured api error', async () => {
    mockApiCall.mockRejectedValue(new Error('Email already exists'));
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(window.alert).toHaveBeenCalledWith('Email already exists');
  });

  it('alerts when role change fails', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '角色更新失败' });
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleChangeRole('user-1', 'USER');
    });

    expect(window.alert).toHaveBeenCalledWith('角色更新失败');
  });

  it('loads users into state when list succeeds', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: [{ id: 'user-1', email: 'user@example.com', role: 'USER' }],
    });
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.loadUsers();
    });

    expect(setUsers).toHaveBeenCalledWith([{ id: 'user-1', email: 'user@example.com', role: 'USER' }]);
  });

  it('clears parent options when parent lookup fails', async () => {
    mockApiCall.mockRejectedValue(new Error('load failed'));
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.loadParentOptions('USER');
    });

    expect(setParentOptions).toHaveBeenCalledWith([]);
    expect(setLoadingParents).toHaveBeenLastCalledWith(false);
  });

  it('resets password and shows success alert', async () => {
    mockApiCall.mockResolvedValue({ success: true, message: '密码已重置' });
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleResetPassword('user-1');
    });

    expect(mockApiCall).toHaveBeenCalledWith('auth', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reset-password', userId: 'user-1', password: 'Reset@2026!' }),
    }));
    expect(window.alert).toHaveBeenCalledWith('密码已重置');
  });

  it('shows backend role update success message before refreshing list', async () => {
    mockApiCall
      .mockResolvedValueOnce({ success: true, message: '角色已更新' })
      .mockResolvedValueOnce({ success: true, data: [] });

    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleChangeRole('user-1', 'USER');
    });

    expect(window.alert).toHaveBeenCalledWith('角色已更新');
    expect(setUsers).toHaveBeenCalledWith([]);
  });

  it('does not delete user when confirmation is cancelled', async () => {
    jest.spyOn(window, 'confirm').mockImplementation(() => false);
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleDelete('user-1');
    });

    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('alerts when delete fails with structured api error', async () => {
    mockApiCall.mockRejectedValue(new Error('Permission denied'));
    const { result } = renderHook(() => useUserActions(createDeps()));

    await act(async () => {
      await result.current.handleDelete('user-1');
    });

    expect(window.alert).toHaveBeenCalledWith('Permission denied');
  });
});
