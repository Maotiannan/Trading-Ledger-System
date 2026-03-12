import { buildSettingsAuditViewModel } from './view-model';
import type { SettingsAuditEntry, SettingsAuditExportEntry, SettingsAuditFilterState, SettingsAuditMeta } from './types';

describe('buildSettingsAuditViewModel', () => {
  const tx = (zh: string, _en: string) => zh;
  const filters: SettingsAuditFilterState = {
    actorQuery: 'admin@example.com',
    settingKey: 'OCR_DISABLED',
    dateFrom: '2026-03-12T08:00',
    dateTo: '2026-03-12T09:00',
    pageSize: 20,
    exportLimit: 5000,
  };
  const meta: SettingsAuditMeta = {
    defaultPageSize: 20,
    maxPageSize: 100,
    maxExportRows: 5000,
    pageSizeOptions: [20, 50, 100],
    cursorMode: 'id',
  };

  it('builds display rows, summary items, and export options from raw audit data', () => {
    const entries: SettingsAuditEntry[] = [{
      id: 'audit-1',
      createdAt: '2026-03-12T08:30:00.000Z',
      actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      updatedKeys: ['OCR_DISABLED'],
      changes: [{ key: 'OCR_DISABLED', before: '', after: 'true' }],
    }];
    const exportHistoryEntries: SettingsAuditExportEntry[] = [{
      id: 'export-1',
      createdAt: '2026-03-12T08:35:00.000Z',
      actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      rowCount: 20,
      exportLimit: 20,
      maxExportRows: 5000,
      truncated: true,
      filterActor: '',
      filterKey: 'OCR_DISABLED',
      filterDateFrom: '',
      filterDateTo: '2026-03-12T09:00',
      exportedKeys: ['OCR_DISABLED'],
    }];

    const result = buildSettingsAuditViewModel({
      tx,
      filters,
      meta,
      keyOptions: ['SWIFT_WARNING_TOLERANCE', 'OCR_DISABLED'],
      entries,
      exportHistoryEntries,
      hasMore: true,
      exportHistoryHasMore: false,
    });

    expect(result.exportOptions).toEqual([500, 1000, 2000, 5000]);
    expect(result.auditHasMore).toBe(true);
    expect(result.exportHistoryHasMore).toBe(false);
    expect(result.auditSummaryItems[3]?.value).toBe('还有更多记录可加载');
    expect(result.exportHistorySummaryItems[1]?.value).toBe('历史记录已加载到末尾');
    expect(result.auditRows[0]).toEqual(expect.objectContaining({
      actorEmail: 'admin@example.com',
      updatedKeys: ['OCR_DISABLED'],
    }));
    expect(result.auditRows[0]?.changes[0]).toEqual({
      id: 'audit-1-OCR_DISABLED',
      key: 'OCR_DISABLED',
      beforeValue: '-',
      afterValue: 'true',
    });
    expect(result.exportHistoryRows[0]?.summaryItems[3]?.value).toBe('已截断');
    expect(result.exportHistoryRows[0]?.filterItems[0]?.value).toBe('-');
  });

  it('falls back to raw timestamp strings when date parsing fails', () => {
    const result = buildSettingsAuditViewModel({
      tx,
      filters,
      meta,
      keyOptions: [],
      entries: [{
        id: 'audit-invalid',
        createdAt: 'not-a-date',
        actor: null,
        updatedKeys: [],
        changes: [],
      }],
      exportHistoryEntries: [],
      hasMore: false,
      exportHistoryHasMore: false,
    });

    expect(result.auditRows[0]?.createdAtLabel).toBe('not-a-date');
    expect(result.auditRows[0]?.actorEmail).toBe('-');
  });
});
