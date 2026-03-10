import { act, renderHook } from '@testing-library/react';
import { useSettingsActions } from './use-settings-actions';
import type { PasswordFormState, PurgeFormState } from '../types';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
  };
});

const mockApiCall = apiCall as jest.Mock;

describe('useSettingsActions', () => {
  const tx = (zh: string, _en: string) => zh;
  let purgeFormState: PurgeFormState;
  let pwdState: PasswordFormState;

  beforeEach(() => {
    mockApiCall.mockReset();
    purgeFormState = { targetUserId: 'sales-1', password: 'Admin@2026!', modules: ['customer'] };
    pwdState = { oldPassword: 'old-pass', newPassword: 'new-pass-1', confirmPassword: 'new-pass-1' };
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createDeps() {
    return {
      tx,
      userEmail: 'admin@example.com',
      canEditConfig: true,
      canPurgeBranch: true,
      config: { DETAIL_RECEIPT_MATCH_TOLERANCE: '5' },
      branchPurgeTargets: [{ id: 'sales-1', email: 'sales@example.com', name: 'Sales', level: 3, role: 'SALES', parentId: 'admin-1' }],
      purgeForm: purgeFormState,
      pwd: pwdState,
      setLoading: jest.fn(),
      setSavingConfig: jest.fn(),
      setTestingConfig: jest.fn(),
      setPasswordLoading: jest.fn(),
      setMessage: jest.fn(),
      setError: jest.fn(),
      setConfig: jest.fn(),
      setCanEditConfig: jest.fn(),
      setCanPurgeBranch: jest.fn(),
      setBranchPurgeTargets: jest.fn(),
      setPurgeModuleKeys: jest.fn(),
      setPurgingBranch: jest.fn(),
      setPurgeForm: jest.fn((value: PurgeFormState | ((prev: PurgeFormState) => PurgeFormState)) => {
        purgeFormState = typeof value === 'function' ? value(purgeFormState) : value;
      }),
      setPwd: jest.fn((value: PasswordFormState) => {
        pwdState = value;
      }),
    };
  }

  it('loads settings and selects a valid purge target', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        settings: { DETAIL_RECEIPT_MATCH_TOLERANCE: '8' },
        canEdit: true,
        canPurgeBranch: true,
        branchPurgeTargets: [{ id: 'sales-2', email: 'sales2@example.com', name: 'Sales 2', level: 3, role: 'SALES', parentId: 'admin-1' }],
        purgeModuleKeys: ['customer', 'invoice', 'all'],
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettings();
    });

    expect(deps.setConfig).toHaveBeenCalledWith({ DETAIL_RECEIPT_MATCH_TOLERANCE: '8' });
    expect(deps.setCanEditConfig).toHaveBeenCalledWith(true);
    expect(deps.setCanPurgeBranch).toHaveBeenCalledWith(true);
    expect(deps.setBranchPurgeTargets).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'sales-2' })]));
    expect(purgeFormState.targetUserId).toBe('sales-2');
  });

  it('blocks password change when confirmation mismatches', async () => {
    pwdState = { oldPassword: 'old', newPassword: 'new1', confirmPassword: 'new2' };
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleChangePassword();
    });

    expect(deps.setError).toHaveBeenCalledWith('两次输入的新密码不一致');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('purges branch after confirmation and clears password field', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: true, message: 'purged' });
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'purge-branch-data',
        targetUserId: 'sales-1',
        password: 'Admin@2026!',
        modules: ['customer'],
      }),
    }));
    expect(deps.setMessage).toHaveBeenCalledWith('purged');
    expect(purgeFormState.password).toBe('');
  });
});
