import { buildSettingsPageViewModel } from './page-view-model';

describe('buildSettingsPageViewModel', () => {
  const tx = (zh: string, _en: string) => zh;

  it('builds settings page state from raw settings module state', () => {
    const result = buildSettingsPageViewModel({
      tx,
      appVersion: '1.0.74',
      userRole: 'SALES',
      error: null,
      message: '已保存',
      filters: {
        actorQuery: '',
        settingKey: '',
        dateFrom: '',
        dateTo: '',
        pageSize: 20,
        exportLimit: 5000,
      },
      meta: {
        defaultPageSize: 20,
        maxPageSize: 100,
        maxExportRows: 5000,
        pageSizeOptions: [20, 50, 100],
        cursorMode: 'id',
      },
      keyOptions: ['OCR_DISABLED'],
      entries: [],
      exportHistoryEntries: [],
      hasMore: false,
      exportHistoryHasMore: true,
    });

    expect(result.title).toBe('设置');
    expect(result.versionLabel).toBe('1.0.74');
    expect(result.canManageUsers).toBe(true);
    expect(result.alertMessage).toBe('已保存');
    expect(result.alertVariant).toBe('default');
    expect(result.auditView.exportHistoryHasMore).toBe(true);
    expect(result.auditView.keyOptions).toEqual(['OCR_DISABLED']);
  });

  it('prefers error state and hides user management for non-manager roles', () => {
    const result = buildSettingsPageViewModel({
      tx,
      appVersion: '1.0.74',
      userRole: 'USER',
      error: '失败',
      message: '已保存',
      filters: {
        actorQuery: '',
        settingKey: '',
        dateFrom: '',
        dateTo: '',
        pageSize: 20,
        exportLimit: 5000,
      },
      meta: {
        defaultPageSize: 20,
        maxPageSize: 100,
        maxExportRows: 5000,
        pageSizeOptions: [20, 50, 100],
        cursorMode: 'id',
      },
      keyOptions: [],
      entries: [],
      exportHistoryEntries: [],
      hasMore: false,
      exportHistoryHasMore: false,
    });

    expect(result.canManageUsers).toBe(false);
    expect(result.alertMessage).toBe('失败');
    expect(result.alertVariant).toBe('destructive');
  });

  it('returns null alert message when neither error nor message exists', () => {
    const result = buildSettingsPageViewModel({
      tx,
      appVersion: '1.0.74',
      userRole: null,
      error: null,
      message: null,
      filters: {
        actorQuery: '',
        settingKey: '',
        dateFrom: '',
        dateTo: '',
        pageSize: 20,
        exportLimit: 5000,
      },
      meta: {
        defaultPageSize: 20,
        maxPageSize: 100,
        maxExportRows: 5000,
        pageSizeOptions: [20, 50, 100],
        cursorMode: 'id',
      },
      keyOptions: [],
      entries: [],
      exportHistoryEntries: [],
      hasMore: false,
      exportHistoryHasMore: false,
    });

    expect(result.canManageUsers).toBe(false);
    expect(result.alertMessage).toBeNull();
    expect(result.alertVariant).toBe('default');
  });
});
