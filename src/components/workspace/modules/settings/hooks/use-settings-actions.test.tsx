import { act, renderHook } from '@testing-library/react';
import { useSettingsActions } from './use-settings-actions';
import type { PasswordFormState, PurgeFormState, SettingsAuditFilterState, SettingsAuditMeta } from '../types';
import { apiCall, getApiErrorMessage, getApiResponseErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    getApiResponseErrorMessage: jest.fn(async (_response: Response, fallback: string) => fallback),
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
const mockGetApiResponseErrorMessage = getApiResponseErrorMessage as jest.Mock;
const originalFetch = globalThis.fetch;

describe('useSettingsActions', () => {
  const tx = (zh: string, _en: string) => zh;
  let purgeFormState: PurgeFormState;
  let pwdState: PasswordFormState;
  let auditFiltersState: SettingsAuditFilterState;
  let auditMetaState: SettingsAuditMeta;

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetApiErrorMessage.mockClear();
    mockGetApiResponseErrorMessage.mockClear();
    purgeFormState = { targetUserId: 'sales-1', password: 'Admin@2026!', modules: ['customer'] };
    pwdState = { oldPassword: 'old-pass', newPassword: 'new-pass-1', confirmPassword: 'new-pass-1' };
    auditFiltersState = { actorQuery: '', settingKey: '', dateFrom: '', dateTo: '', pageSize: 20, exportLimit: 5000 };
    auditMetaState = { defaultPageSize: 20, maxPageSize: 100, maxExportRows: 5000, pageSizeOptions: [20, 50, 100], cursorMode: 'id' };
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: originalFetch });
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
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
      auditFilters: auditFiltersState,
      auditMeta: auditMetaState,
      setLoading: jest.fn(),
      setSavingConfig: jest.fn(),
      setTestingConfig: jest.fn(),
      setPasswordLoading: jest.fn(),
      setAuditLoading: jest.fn(),
      setAuditLoadingMore: jest.fn(),
      setAuditExporting: jest.fn(),
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
      setSettingsAuditMeta: jest.fn((value: SettingsAuditMeta) => {
        auditMetaState = value;
      }),
      setSettingsAuditFilters: jest.fn((value: SettingsAuditFilterState | ((prev: SettingsAuditFilterState) => SettingsAuditFilterState)) => {
        auditFiltersState = typeof value === 'function' ? value(auditFiltersState) : value;
      }),
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
        auditCapabilities: { defaultPageSize: 20, maxPageSize: 80, maxExportRows: 1200, pageSizeOptions: [20, 50, 80], cursorMode: 'id' },
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
    expect(auditMetaState).toEqual({ defaultPageSize: 20, maxPageSize: 80, maxExportRows: 1200, pageSizeOptions: [20, 50, 80], cursorMode: 'id' });
    expect(auditFiltersState.exportLimit).toBe(1200);
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
        auditCapabilities: { defaultPageSize: 20, maxPageSize: 100, maxExportRows: 5000, pageSizeOptions: [20, 50, 100], cursorMode: 'id' },
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
          meta: auditMetaState,
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
        meta: auditMetaState,
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

  it('includes audit filters when applying audit filters', async () => {
    auditFiltersState = {
      actorQuery: 'admin@example.com',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-11T07:00',
      dateTo: '2026-03-11T08:00',
      pageSize: 50,
      exportLimit: 1000,
    };
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: { items: [], nextCursor: null, meta: auditMetaState },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.applyAuditFilters();
    });

    expect(mockApiCall).toHaveBeenCalledWith(
      'settings?view=audit&limit=50&actor=admin%40example.com&key=OCR_DISABLED&dateFrom=2026-03-11T07%3A00&dateTo=2026-03-11T08%3A00',
    );
  });

  it('resets audit filters and reloads unfiltered audit logs', async () => {
    auditFiltersState = {
      actorQuery: 'admin@example.com',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-11T07:00',
      dateTo: '2026-03-11T08:00',
      pageSize: 50,
      exportLimit: 1000,
    };
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: { items: [], nextCursor: null, meta: auditMetaState },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.resetAuditFilters();
    });

    expect(auditFiltersState).toEqual({ actorQuery: '', settingKey: '', dateFrom: '', dateTo: '', pageSize: 20, exportLimit: 5000 });
    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit&limit=20');
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
        meta: auditMetaState,
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

  it('exports audit logs as csv using active filters', async () => {
    auditFiltersState = {
      actorQuery: 'admin@example.com',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-11T07:00',
      dateTo: '2026-03-11T08:00',
      pageSize: 100,
      exportLimit: 1000,
    };
    const deps = createDeps();
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchor = originalCreateElement('a');
    const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['time,actor\n'])),
      headers: {
        get: (name: string) => (
          name.toLowerCase() === 'content-disposition'
            ? 'attachment; filename="settings-audit.csv"'
            : name.toLowerCase() === 'x-export-summary'
              ? encodeURIComponent('配置审计导出完成：已导出 88 条（服务端上限 5000，结果已截断）')
              : null
        ),
      },
    } as unknown as Response);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'a') return anchor;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:audit') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.exportSettingsAudit();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings?view=audit&format=csv&exportLimit=1000&actor=admin%40example.com&key=OCR_DISABLED&dateFrom=2026-03-11T07%3A00&dateTo=2026-03-11T08%3A00',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(anchor.download).toBe('settings-audit.csv');
    expect(clickSpy).toHaveBeenCalled();
    expect(deps.setMessage).toHaveBeenCalledWith('配置审计导出完成：已导出 88 条（服务端上限 5000，结果已截断）');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });

  it('builds export summary from headers when server summary is absent', async () => {
    const deps = createDeps();
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchor = originalCreateElement('a');
    jest.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['time,actor\n'])),
      headers: {
        get: (name: string) => {
          switch (name.toLowerCase()) {
            case 'content-disposition':
              return 'attachment; filename="settings-audit.csv"';
            case 'x-export-row-count':
              return '20';
            case 'x-export-limit-applied':
              return '20';
            case 'x-export-limit-max':
              return '5000';
            case 'x-export-truncated':
              return 'false';
            default:
              return null;
          }
        },
      },
    } as unknown as Response);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'a') return anchor;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:audit') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.exportSettingsAudit();
    });

    expect(deps.setMessage).toHaveBeenCalledWith('配置审计导出完成：已导出 20 条（服务端上限 5000）');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
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
