import type {
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from './types';
import { formatAppDateTime } from '@/lib/app-time';

export type SettingsTx = (zh: string, en: string) => string;

export type SettingsAuditSummaryItemViewModel = {
  id: string;
  label: string;
  value: string;
};

export type SettingsAuditChangeViewModel = {
  id: string;
  key: string;
  beforeValue: string;
  afterValue: string;
};

export type SettingsAuditRowViewModel = {
  id: string;
  createdAtLabel: string;
  actorEmail: string;
  actorName: string | null;
  updatedKeys: string[];
  changes: SettingsAuditChangeViewModel[];
};

export type SettingsAuditExportHistoryRowViewModel = {
  id: string;
  createdAtLabel: string;
  actorEmail: string;
  actorName: string | null;
  summaryItems: SettingsAuditSummaryItemViewModel[];
  filterItems: SettingsAuditSummaryItemViewModel[];
  exportedKeys: string[];
};

export type SettingsAuditViewModel = {
  filters: SettingsAuditFilterState;
  keyOptions: string[];
  pageSizeOptions: number[];
  exportOptions: number[];
  auditHasMore: boolean;
  exportHistoryHasMore: boolean;
  noAccessMessage: string;
  emptyAuditMessage: string;
  emptyHistoryMessage: string;
  auditSummaryItems: SettingsAuditSummaryItemViewModel[];
  exportHistorySummaryItems: SettingsAuditSummaryItemViewModel[];
  auditRows: SettingsAuditRowViewModel[];
  exportHistoryRows: SettingsAuditExportHistoryRowViewModel[];
};

export type BuildSettingsAuditViewModelInput = {
  tx: SettingsTx;
  filters: SettingsAuditFilterState;
  meta: SettingsAuditMeta;
  keyOptions: string[];
  entries: SettingsAuditEntry[];
  exportHistoryEntries: SettingsAuditExportEntry[];
  hasMore: boolean;
  exportHistoryHasMore: boolean;
};

function formatDateLabel(value: string) {
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) {
    return value || '-';
  }
  return formatAppDateTime(nextDate);
}

function displayAuditValue(value: string) {
  return value || '-';
}

function buildSummaryItem(id: string, label: string, value: string): SettingsAuditSummaryItemViewModel {
  return { id, label, value };
}

export function buildSettingsAuditViewModel({
  tx,
  filters,
  meta,
  keyOptions,
  entries,
  exportHistoryEntries,
  hasMore,
  exportHistoryHasMore,
}: BuildSettingsAuditViewModelInput): SettingsAuditViewModel {
  const exportOptions = Array.from(new Set([500, 1000, 2000, 5000, meta.maxExportRows]))
    .filter((value) => value <= meta.maxExportRows)
    .sort((a, b) => a - b);

  return {
    filters,
    keyOptions: [...keyOptions].sort(),
    pageSizeOptions: meta.pageSizeOptions,
    exportOptions,
    auditHasMore: hasMore,
    exportHistoryHasMore,
    noAccessMessage: tx('仅管理员可查看配置变更审计。', 'Only admins can view configuration audit logs.'),
    emptyAuditMessage: tx('暂无配置审计记录。', 'No configuration audit logs yet.'),
    emptyHistoryMessage: tx('暂无导出历史。', 'No export history yet.'),
    auditSummaryItems: [
      buildSummaryItem('loaded', tx('当前已加载', 'Loaded'), String(entries.length)),
      buildSummaryItem('page-size', tx('分页大小', 'Page Size'), String(filters.pageSize)),
      buildSummaryItem('pagination', tx('分页模式', 'Pagination'), `${tx('游标', 'Cursor')} (${meta.cursorMode})`),
      buildSummaryItem('has-more', tx('状态', 'Status'), hasMore ? tx('还有更多记录可加载', 'More entries available') : tx('已加载到末尾', 'Reached the end')),
    ],
    exportHistorySummaryItems: [
      buildSummaryItem('history-loaded', tx('当前已加载', 'Loaded'), String(exportHistoryEntries.length)),
      buildSummaryItem('history-status', tx('状态', 'Status'), exportHistoryHasMore ? tx('还有更多历史记录可加载', 'More history entries available') : tx('历史记录已加载到末尾', 'Reached the end of history')),
    ],
    auditRows: entries.map((entry) => ({
      id: entry.id,
      createdAtLabel: formatDateLabel(entry.createdAt),
      actorEmail: entry.actor?.email || '-',
      actorName: entry.actor?.name || null,
      updatedKeys: entry.updatedKeys,
      changes: entry.changes.map((change) => ({
        id: `${entry.id}-${change.key}`,
        key: change.key,
        beforeValue: displayAuditValue(change.before),
        afterValue: displayAuditValue(change.after),
      })),
    })),
    exportHistoryRows: exportHistoryEntries.map((entry) => ({
      id: entry.id,
      createdAtLabel: formatDateLabel(entry.createdAt),
      actorEmail: entry.actor?.email || '-',
      actorName: entry.actor?.name || null,
      summaryItems: [
        buildSummaryItem('rows', tx('导出条数', 'Rows'), String(entry.rowCount)),
        buildSummaryItem('requested-limit', tx('请求上限', 'Requested limit'), String(entry.exportLimit)),
        buildSummaryItem('server-cap', tx('服务端上限', 'Server cap'), String(entry.maxExportRows)),
        buildSummaryItem('result', tx('结果状态', 'Result'), entry.truncated ? tx('已截断', 'Truncated') : tx('完整导出', 'Complete')),
      ],
      filterItems: [
        buildSummaryItem('actor-filter', tx('操作者筛选', 'Actor filter'), entry.filterActor || '-'),
        buildSummaryItem('setting-filter', tx('配置键筛选', 'Setting key filter'), entry.filterKey || '-'),
        buildSummaryItem('date-from', tx('开始时间', 'Date From'), entry.filterDateFrom || '-'),
        buildSummaryItem('date-to', tx('结束时间', 'Date To'), entry.filterDateTo || '-'),
      ],
      exportedKeys: entry.exportedKeys,
    })),
  };
}
