import {
  buildEmptySettingsAuditFilters,
  buildSettingsAuditQuery,
  clampSettingsAuditFilters,
  defaultSettingsAuditMeta,
  normalizeSettingsAuditExportHistoryPage,
  normalizeSettingsAuditMeta,
  normalizeSettingsAuditPage,
  normalizeSettingsBootstrap,
} from './read-model';

describe('settings read-model', () => {
  it('normalizes malformed audit meta values into safe bounds', () => {
    expect(normalizeSettingsAuditMeta({
      defaultPageSize: 999,
      maxPageSize: 10,
      maxExportRows: -5,
      pageSizeOptions: ['bad', 10, 10, 50],
      cursorMode: 'unexpected',
    })).toEqual({
      defaultPageSize: 10,
      maxPageSize: 10,
      maxExportRows: 1,
      pageSizeOptions: [10],
      cursorMode: 'id',
    });
  });

  it('builds empty filters and clamps page/export limits', () => {
    const meta = {
      defaultPageSize: 30,
      maxPageSize: 80,
      maxExportRows: 500,
      pageSizeOptions: [30, 80],
      cursorMode: 'id' as const,
    };

    expect(buildEmptySettingsAuditFilters(meta)).toEqual({
      actorQuery: '',
      settingKey: '',
      dateFrom: '',
      dateTo: '',
      pageSize: 30,
      exportLimit: 500,
    });

    expect(clampSettingsAuditFilters({
      actorQuery: 'admin',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-10',
      dateTo: '2026-03-12',
      pageSize: 999,
      exportLimit: 0,
    }, meta)).toEqual({
      actorQuery: 'admin',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-10',
      dateTo: '2026-03-12',
      pageSize: 80,
      exportLimit: 500,
    });
  });

  it('builds audit queries for page fetches and exports', () => {
    const filters = {
      actorQuery: 'admin@example.com',
      settingKey: 'OCR_DISABLED',
      dateFrom: '2026-03-10',
      dateTo: '2026-03-12',
      pageSize: 50,
      exportLimit: 250,
    };

    expect(buildSettingsAuditQuery('audit', filters, 'cursor-1')).toContain('cursor=cursor-1');
    expect(buildSettingsAuditQuery('audit', filters, null, { format: 'csv', includeLimit: false })).toBe(
      'view=audit&format=csv&exportLimit=250&actor=admin%40example.com&key=OCR_DISABLED&dateFrom=2026-03-10&dateTo=2026-03-12',
    );
  });

  it('normalizes bootstrap payloads and falls back when payload is malformed', () => {
    expect(normalizeSettingsBootstrap({
      settings: { OCR_DISABLED: 'false' },
      canEdit: true,
      canViewAudit: true,
      canPurgeBranch: false,
      branchPurgeTargets: [{ id: 'sales-1' }],
      purgeModuleKeys: ['invoice'],
      auditCapabilities: { defaultPageSize: 25, maxPageSize: 80, maxExportRows: 1000, pageSizeOptions: [25, 50], cursorMode: 'id' },
    })).toEqual({
      config: { OCR_DISABLED: 'false' },
      canEditConfig: true,
      canViewAudit: true,
      canPurgeBranch: false,
      branchPurgeTargets: [{ id: 'sales-1' }],
      purgeModuleKeys: ['invoice'],
      auditMeta: {
        defaultPageSize: 25,
        maxPageSize: 80,
        maxExportRows: 1000,
        pageSizeOptions: [25, 50],
        cursorMode: 'id',
      },
    });

    expect(normalizeSettingsBootstrap(null)).toEqual({
      config: {},
      canEditConfig: false,
      canViewAudit: false,
      canPurgeBranch: false,
      branchPurgeTargets: [],
      purgeModuleKeys: [],
      auditMeta: defaultSettingsAuditMeta,
    });
  });

  it('normalizes audit pages and export history pages', () => {
    const fallbackMeta = defaultSettingsAuditMeta;

    expect(normalizeSettingsAuditPage({
      items: [{ id: 'audit-1' }],
      nextCursor: 'cursor-2',
      meta: { defaultPageSize: 10, maxPageSize: 10, maxExportRows: 100, pageSizeOptions: [10], cursorMode: 'id' },
    }, fallbackMeta)).toEqual({
      items: [{ id: 'audit-1' }],
      nextCursor: 'cursor-2',
      meta: {
        defaultPageSize: 10,
        maxPageSize: 10,
        maxExportRows: 100,
        pageSizeOptions: [10],
        cursorMode: 'id',
      },
    });

    expect(normalizeSettingsAuditExportHistoryPage({}, fallbackMeta)).toEqual({
      items: [],
      nextCursor: null,
      meta: fallbackMeta,
    });
  });
});
