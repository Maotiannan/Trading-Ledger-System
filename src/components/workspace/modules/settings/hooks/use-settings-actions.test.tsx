import { act, renderHook } from '@testing-library/react';
import { useSettingsActions } from './use-settings-actions';
import type {
  PasswordFormState,
  PurgeFormState,
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from '../types';
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
  let auditCursorState: string | null;
  let auditExportHistoryCursorState: string | null;
  let auditEntriesState: SettingsAuditEntry[];
  let auditExportHistoryEntriesState: SettingsAuditExportEntry[];

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetApiErrorMessage.mockClear();
    mockGetApiResponseErrorMessage.mockClear();
    purgeFormState = { targetUserId: 'sales-1', password: 'Admin@2026!', modules: ['customer'] };
    pwdState = { oldPassword: 'old-pass', newPassword: 'new-pass-1', confirmPassword: 'new-pass-1' };
    auditFiltersState = { actorQuery: '', settingKey: '', dateFrom: '', dateTo: '', pageSize: 20, exportLimit: 5000 };
    auditMetaState = { defaultPageSize: 20, maxPageSize: 100, maxExportRows: 5000, pageSizeOptions: [20, 50, 100], cursorMode: 'id' };
    auditCursorState = null;
    auditExportHistoryCursorState = null;
    auditEntriesState = [];
    auditExportHistoryEntriesState = [];
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
      auditCursor: auditCursorState,
      auditExportHistoryCursor: auditExportHistoryCursorState,
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
      setSettingsAuditEntries: jest.fn((value: SettingsAuditEntry[] | ((prev: SettingsAuditEntry[]) => SettingsAuditEntry[])) => {
        auditEntriesState = typeof value === 'function' ? value(auditEntriesState) : value;
      }),
      setSettingsAuditCursor: jest.fn(),
      setSettingsAuditHasMore: jest.fn(),
      setSettingsAuditExportHistoryEntries: jest.fn((value: SettingsAuditExportEntry[] | ((prev: SettingsAuditExportEntry[]) => SettingsAuditExportEntry[])) => {
        auditExportHistoryEntriesState = typeof value === 'function' ? value(auditExportHistoryEntriesState) : value;
      }),
      setSettingsAuditExportHistoryCursor: jest.fn(),
      setSettingsAuditExportHistoryHasMore: jest.fn(),
      setSettingsAuditExportHistoryLoading: jest.fn(),
      setSettingsAuditExportHistoryLoadingMore: jest.fn(),
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
    expect(deps.setSettingsAuditExportHistoryEntries).toHaveBeenCalledWith([]);
    expect(deps.setSettingsAuditExportHistoryCursor).toHaveBeenCalledWith(null);
    expect(deps.setSettingsAuditExportHistoryHasMore).toHaveBeenCalledWith(false);
  });

  it('surfaces settings bootstrap request failures', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('加载设置失败'));

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettings();
    });

    expect(deps.setError).toHaveBeenCalledWith('加载设置失败');
    expect(deps.setLoading).toHaveBeenCalledWith(true);
    expect(deps.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('normalizes malformed audit capabilities from settings bootstrap', async () => {
    auditFiltersState = {
      actorQuery: '',
      settingKey: '',
      dateFrom: '',
      dateTo: '',
      pageSize: 999,
      exportLimit: 999999,
    };
    purgeFormState = { targetUserId: 'missing-target', password: 'Admin@2026!', modules: ['customer'] };
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        settings: { DETAIL_RECEIPT_MATCH_TOLERANCE: '8' },
        canEdit: true,
        canViewAudit: true,
        canPurgeBranch: true,
        branchPurgeTargets: [{ id: 'sales-2', email: 'sales2@example.com', name: 'Sales 2', level: 3, role: 'SALES', parentId: 'admin-1' }],
        purgeModuleKeys: ['customer'],
        auditCapabilities: { defaultPageSize: 0, maxPageSize: 0, maxExportRows: -1, pageSizeOptions: ['bad'], cursorMode: 'unexpected' },
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettings();
    });

    expect(auditMetaState).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      maxExportRows: 1,
      pageSizeOptions: [20],
      cursorMode: 'id',
    });
    expect(auditFiltersState.pageSize).toBe(100);
    expect(auditFiltersState.exportLimit).toBe(1);
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

  it('surfaces OCR test success detail in message', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: true, message: 'OCR 测试成功', detail: 'detected 1 receipt' });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleTestOcrConfig();
    });

    expect(deps.setMessage).toHaveBeenCalledWith('OCR 测试成功 | detected 1 receipt');
  });

  it('surfaces OCR test backend failures through shared mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: false, error: 'OCR 测试失败' });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleTestOcrConfig();
    });

    expect(deps.setError).toHaveBeenCalledWith('OCR 测试失败');
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

  it('surfaces password change request failures through shared error mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('password request failed'));
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleChangePassword();
    });

    expect(deps.setError).toHaveBeenCalledWith('password request failed');
    expect(deps.setPasswordLoading).toHaveBeenCalledWith(true);
    expect(deps.setPasswordLoading).toHaveBeenLastCalledWith(false);
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

  it('surfaces audit load failures through shared mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('加载配置审计失败'));

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAudit();
    });

    expect(deps.setError).toHaveBeenCalledWith('加载配置审计失败');
    expect(deps.setAuditLoading).toHaveBeenCalledWith(true);
    expect(deps.setAuditLoading).toHaveBeenLastCalledWith(false);
  });

  it('loads export history independently', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{
          id: 'audit-export-1',
          createdAt: '2026-03-11T07:20:00.000Z',
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
          rowCount: 88,
          exportLimit: 100,
          maxExportRows: 5000,
          truncated: true,
          filterActor: 'admin@example.com',
          filterKey: 'OCR_DISABLED',
          filterDateFrom: '2026-03-11T07:00',
          filterDateTo: '2026-03-11T08:00',
          exportedKeys: ['OCR_DISABLED'],
        }],
        nextCursor: 'audit-export-1',
        meta: auditMetaState,
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAuditExportHistory();
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit-export-history&limit=20');
    expect(deps.setSettingsAuditExportHistoryEntries).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.setSettingsAuditExportHistoryCursor).toHaveBeenCalledWith('audit-export-1');
    expect(deps.setSettingsAuditExportHistoryHasMore).toHaveBeenCalledWith(true);
  });

  it('surfaces export history load failures through shared mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('加载导出历史失败'));

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAuditExportHistory();
    });

    expect(deps.setError).toHaveBeenCalledWith('加载导出历史失败');
    expect(deps.setSettingsAuditExportHistoryLoading).toHaveBeenCalledWith(true);
    expect(deps.setSettingsAuditExportHistoryLoading).toHaveBeenLastCalledWith(false);
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
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        data: { items: [], nextCursor: null, meta: auditMetaState },
      })
      .mockResolvedValueOnce({
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
    expect(mockApiCall).toHaveBeenCalledWith(
      'settings?view=audit-export-history&limit=50&actor=admin%40example.com&key=OCR_DISABLED&dateFrom=2026-03-11T07%3A00&dateTo=2026-03-11T08%3A00',
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
    mockApiCall
      .mockResolvedValueOnce({
        success: true,
        data: { items: [], nextCursor: null, meta: auditMetaState },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { items: [], nextCursor: null, meta: auditMetaState },
      });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.resetAuditFilters();
    });

    expect(auditFiltersState).toEqual({ actorQuery: '', settingKey: '', dateFrom: '', dateTo: '', pageSize: 20, exportLimit: 5000 });
    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit&limit=20');
    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit-export-history&limit=20');
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

  it('clears export history state without requesting backend when audit is not allowed', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      canViewAudit: false,
    }));

    await act(async () => {
      await result.current.loadSettingsAuditExportHistory();
    });

    expect(mockApiCall).not.toHaveBeenCalled();
    expect(deps.setSettingsAuditExportHistoryEntries).toHaveBeenCalledWith([]);
    expect(deps.setSettingsAuditExportHistoryCursor).toHaveBeenCalledWith(null);
    expect(deps.setSettingsAuditExportHistoryHasMore).toHaveBeenCalledWith(false);
  });

  it('loads more audit logs with cursor when appending', async () => {
    auditCursorState = 'audit-1';
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{ id: 'audit-2', createdAt: '2026-03-11T07:21:00.000Z', actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' }, updatedKeys: ['OCR_DISABLED'], changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }] }],
        nextCursor: null,
        meta: auditMetaState,
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAudit({ append: true });
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit&limit=20&cursor=audit-1');
    expect(deps.setAuditLoadingMore).toHaveBeenCalledWith(true);
    expect(deps.setAuditLoadingMore).toHaveBeenLastCalledWith(false);
  });

  it('loads more export history with cursor when appending', async () => {
    auditExportHistoryCursorState = 'audit-export-1';
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        items: [{
          id: 'audit-export-2',
          createdAt: '2026-03-11T07:21:00.000Z',
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
          rowCount: 10,
          exportLimit: 20,
          maxExportRows: 5000,
          truncated: false,
          filterActor: '',
          filterKey: '',
          filterDateFrom: '',
          filterDateTo: '',
          exportedKeys: ['OCR_DISABLED'],
        }],
        nextCursor: null,
        meta: auditMetaState,
      },
    });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.loadSettingsAuditExportHistory({ append: true });
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings?view=audit-export-history&limit=20&cursor=audit-export-1');
    expect(deps.setSettingsAuditExportHistoryLoadingMore).toHaveBeenCalledWith(true);
    expect(deps.setSettingsAuditExportHistoryLoadingMore).toHaveBeenLastCalledWith(false);
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
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: { items: [], nextCursor: null, meta: auditMetaState },
    });

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
    expect(mockApiCall).toHaveBeenCalledWith(
      'settings?view=audit-export-history&limit=100&actor=admin%40example.com&key=OCR_DISABLED&dateFrom=2026-03-11T07%3A00&dateTo=2026-03-11T08%3A00',
    );
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

  it('falls back to raw export summary when header decoding fails', async () => {
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
            case 'x-export-summary':
              return '%E0%A4%A';
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

    expect(deps.setMessage).toHaveBeenCalledWith('%E0%A4%A');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });

  it('surfaces export request failures through shared mapper', async () => {
    const deps = createDeps();
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: false } as Response);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.exportSettingsAudit();
    });

    expect(mockGetApiResponseErrorMessage).toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith('导出配置审计失败');
    expect(deps.setAuditExporting).toHaveBeenCalledWith(true);
    expect(deps.setAuditExporting).toHaveBeenLastCalledWith(false);
  });

  it('skips audit export when audit access is disabled', async () => {
    const deps = createDeps();
    const fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });

    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      canViewAudit: false,
    }));

    await act(async () => {
      await result.current.exportSettingsAudit();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deps.setAuditExporting).not.toHaveBeenCalledWith(true);
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

  it('blocks password change when fields are incomplete', async () => {
    pwdState = { oldPassword: '', newPassword: 'new-pass-1', confirmPassword: '' };
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleChangePassword();
    });

    expect(deps.setError).toHaveBeenCalledWith('请填写完整密码信息');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('surfaces password update backend failures', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: false, error: '密码修改失败' });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleChangePassword();
    });

    expect(deps.setError).toHaveBeenCalledWith('密码修改失败');
  });

  it('blocks purge when no purge modules are selected', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      purgeForm: { targetUserId: 'sales-1', password: 'Admin@2026!', modules: [] },
    }));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(deps.setError).toHaveBeenCalledWith('请至少选择一个清理模块');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('blocks purge when selected target is missing from current branch list', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useSettingsActions({
      ...deps,
      purgeForm: { targetUserId: 'missing', password: 'Admin@2026!', modules: ['customer'] },
    }));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(deps.setError).toHaveBeenCalledWith('目标账号不存在');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('surfaces purge api failure through shared error mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: false, error: 'boom' });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(mockApiCall).toHaveBeenCalledWith('settings', expect.any(Object));
    expect(deps.setError).toHaveBeenCalledWith('boom');
    expect(deps.setPurgingBranch).toHaveBeenCalledWith(true);
    expect(deps.setPurgingBranch).toHaveBeenLastCalledWith(false);
  });

  it('surfaces save config backend failures through shared mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockResolvedValueOnce({ success: false, error: '保存失败' });

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(deps.setError).toHaveBeenCalledWith('保存失败');
    expect(deps.setSavingConfig).toHaveBeenCalledWith(true);
    expect(deps.setSavingConfig).toHaveBeenLastCalledWith(false);
  });

  it('surfaces save config request exceptions through shared mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('保存请求失败'));

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handleSaveConfig();
    });

    expect(deps.setError).toHaveBeenCalledWith('保存请求失败');
    expect(deps.setSavingConfig).toHaveBeenCalledWith(true);
    expect(deps.setSavingConfig).toHaveBeenLastCalledWith(false);
  });

  it('surfaces purge request exceptions through shared error mapper', async () => {
    const deps = createDeps();
    mockApiCall.mockRejectedValueOnce(new Error('purge request failed'));

    const { result } = renderHook(() => useSettingsActions(deps));

    await act(async () => {
      await result.current.handlePurgeBranch();
    });

    expect(deps.setError).toHaveBeenCalledWith('purge request failed');
    expect(deps.setPurgingBranch).toHaveBeenCalledWith(true);
    expect(deps.setPurgingBranch).toHaveBeenLastCalledWith(false);
  });
});
