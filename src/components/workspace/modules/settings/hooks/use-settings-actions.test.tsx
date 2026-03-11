import { act, renderHook } from '@testing-library/react';
import { useSettingsActions } from './use-settings-actions';
import type { PasswordFormState, PurgeFormState } from '../types';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    getApiErrorMessage: jest.fn((error: unknown, fallback: string) => {
      if (error instanceof Error) return error.message;
      if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
        return String((error as Record<string, unknown>).error || fallback);
      }
      return fallback;
    }),
  };
});

const mockApiCall = apiCall as jest.Mock;
const mockGetApiErrorMessage = getApiErrorMessage as jest.Mock;

describe('useSettingsActions', () => {
  const tx = (zh: string, _en: string) => zh;
  let purgeFormState: PurgeFormState;
  let pwdState: PasswordFormState;

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetApiErrorMessage.mockClear();
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
      canViewAudit: true,
      canPurgeBranch: true,
      config: { DETAIL_RECEIPT_MATCH_TOLERANCE: '5' },
      branchPurgeTargets: [{ id: 'sales-1', email: 'sales@example.com', name: 'Sales', level: 3, role: 'SALES', parentId: 'admin-1' }],
      purgeForm: purgeFormState,
      pwd: pwdState,
      auditCursor: null,
      setLoading: jest.fn(),
      setSavingConfig: jest.fn(),
      setTestingConfig: jest.fn(),
      setPasswordLoading: jest.fn(),
      setAuditLoading: jest.fn(),
      setAuditLoadingMore: jest.fn(),
      setMessage: jest.fn(),
      setError: jest.fn(),
      setConfig: jest.fn(),
      setCanEditConfig: jest.fn(),
      setCanViewAudit: jest.fn(),
      setCanPurgeBranch: jest.fn(),
      setBranchPurgeTargets: jest.fn(),
      setPurgeModuleKeys: jest.fn(),
      setPurgingBranch: jest.fn(),
      setSettingsAuditEntries: jest.fn(),
      setSettingsAuditCursor: jest.fn(),
      setSettingsAuditHasMore: jest.fn(),
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
        canViewAudit: true,
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
    expect(deps.setCanViewAudit).toHaveBeenCalledWith(true);
    expect(deps.setCanPurgeBranch).toHaveBeenCalledWith(true);
    expect(deps.setBranchPurgeTargets).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'sales-2' })]));
    expect(purgeFormState.targetUserId).toBe('sales-2');
  });

  it('clears audit state when loaded settings disable audit viewing', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        settings: { DETAIL_RECEIPT_MATCH_TOLERANCE: '8' },
        canEdit: true,
        canViewAudit: false,
        canPurgeBranch: true,
        branchPurgeTargets: [],
        purgeModuleKeys: ['customer'],
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettings();
    });

    expect(deps.setSettingsAuditEntries).toHaveBeenCalledWith([]);
    expect(deps.setSettingsAuditCursor).toHaveBeenCalledWith(null);
    expect(deps.setSettingsAuditHasMore).toHaveBeenCalledWith(false);
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

  it('saves config and reports backend message', async () => {
    const deps = createDeps();
    mockApiCall
      .mockResolvedValueOnce({ success: true, message: 'saved' })
      .mockResolvedValueOnce({
        success: true,
        data: {
          items: [{ id: 'audit-1', createdAt: '2026-03-11T07:20:00.000Z', actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' }, updatedKeys: ['DETAIL_RECEIPT_MATCH_TOLERANCE'], changes: [{ key: 'DETAIL_RECEIPT_MATCH_TOLERANCE', before: '5', after: '7' }] }],
          nextCursor: null,
        },
      });
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'update-config',
        settings: { DETAIL_RECEIPT_MATCH_TOLERANCE: '5' },
      }),
    }));
    expect(deps.setMessage).toHaveBeenCalledWith('saved');
    expect(deps.setSettingsAuditEntries).toHaveBeenCalled();
  });

  it('surfaces OCR test failure with detail text', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('OCR test failed | OCR_DISABLED=true'));
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleTestOcrConfig();
    });

    expect(deps.setError).toHaveBeenCalledWith('OCR test failed | OCR_DISABLED=true');
  });

  it('changes password and resets form state on success', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: true, message: 'changed' });
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleChangePassword();
    });

    expect(mockApiCall).toHaveBeenCalledWith('auth', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'change-password',
        oldPassword: 'old-pass',
        newPassword: 'new-pass-1',
      }),
    }));
    expect(pwdState).toEqual({ oldPassword: '', newPassword: '', confirmPassword: '' });
    expect(deps.setMessage).toHaveBeenCalledWith('changed');
  });

  it('loads settings audit logs independently', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{ id: 'audit-1', createdAt: '2026-03-11T07:20:00.000Z', actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' }, updatedKeys: ['OCR_DISABLED'], changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }] }],
        nextCursor: 'audit-1',
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAudit();
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit&limit=20');
    expect(deps.setSettingsAuditEntries).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.setSettingsAuditCursor).toHaveBeenCalledWith('audit-1');
    expect(deps.setSettingsAuditHasMore).toHaveBeenCalledWith(true);
  });

  it('clears audit state without requesting backend when audit is not allowed', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      canViewAudit: false,
    }));

    await act(async () => {
      await result.current.loadSettingsAudit();
    });

    expect(mockApiCall).not.toHaveBeenCalled();
    expect(deps.setSettingsAuditEntries).toHaveBeenCalledWith([]);
    expect(deps.setSettingsAuditCursor).toHaveBeenCalledWith(null);
    expect(deps.setSettingsAuditHasMore).toHaveBeenCalledWith(false);
  });

  it('loads more audit logs with cursor when appending', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{ id: 'audit-2', createdAt: '2026-03-11T07:21:00.000Z', actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' }, updatedKeys: ['OCR_DISABLED'], changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }] }],
        nextCursor: null,
      },
    });

    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      auditCursor: 'audit-1',
    }));

    await act(async () => {
      await result.current.loadSettingsAudit({ append: true });
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit&limit=20&cursor=audit-1');
    expect(deps.setAuditLoadingMore).toHaveBeenCalledWith(true);
    expect(deps.setAuditLoadingMore).toHaveBeenLastCalledWith(false);
  });

  it('blocks purge when target or password is missing', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      purgeForm: { targetUserId: '', password: '', modules: [] },
    }));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(deps.setError).toHaveBeenCalledWith('请先选择账号并填写管理员密码');
    expect(mockApiCall).not.toHaveBeenCalled();
  });
});
