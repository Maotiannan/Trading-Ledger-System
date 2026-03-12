'use client';

import type {
  BranchPurgeTarget,
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from './types';

export const defaultSettingsAuditMeta: SettingsAuditMeta = {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxExportRows: 5000,
  pageSizeOptions: [20, 50, 100],
  cursorMode: 'id',
};

export function buildEmptySettingsAuditFilters(meta: SettingsAuditMeta = defaultSettingsAuditMeta): SettingsAuditFilterState {
  return {
    actorQuery: '',
    settingKey: '',
    dateFrom: '',
    dateTo: '',
    pageSize: meta.defaultPageSize,
    exportLimit: meta.maxExportRows,
  };
}

export function normalizeSettingsAuditMeta(value: unknown): SettingsAuditMeta {
  const source = (value && typeof value === 'object') ? (value as Partial<SettingsAuditMeta>) : {};
  const maxPageSize = Math.max(Number(source.maxPageSize) || defaultSettingsAuditMeta.maxPageSize, 1);
  const maxExportRows = Math.max(Number(source.maxExportRows) || defaultSettingsAuditMeta.maxExportRows, 1);
  const defaultPageSize = Math.min(Math.max(Number(source.defaultPageSize) || defaultSettingsAuditMeta.defaultPageSize, 1), maxPageSize);
  const rawPageSizeOptions = Array.isArray(source.pageSizeOptions) ? source.pageSizeOptions : defaultSettingsAuditMeta.pageSizeOptions;
  const pageSizeOptions = Array.from(new Set(
    rawPageSizeOptions
      .map((item) => Math.max(Math.min(Number(item) || defaultPageSize, maxPageSize), 1))
      .filter((item) => Number.isFinite(item)),
  )).sort((a, b) => a - b);

  return {
    defaultPageSize,
    maxPageSize,
    maxExportRows,
    pageSizeOptions: pageSizeOptions.length > 0 ? pageSizeOptions : [defaultPageSize],
    cursorMode: source.cursorMode === 'id' ? 'id' : 'id',
  };
}

export function clampSettingsAuditFilters(filters: SettingsAuditFilterState, meta: SettingsAuditMeta): SettingsAuditFilterState {
  return {
    ...filters,
    pageSize: Math.max(Math.min(Number(filters.pageSize) || meta.defaultPageSize, meta.maxPageSize), 1),
    exportLimit: Math.max(Math.min(Number(filters.exportLimit) || meta.maxExportRows, meta.maxExportRows), 1),
  };
}

export function buildSettingsAuditQuery(
  view: 'audit' | 'audit-export-history',
  filters: SettingsAuditFilterState,
  cursor?: string | null,
  options: { format?: 'csv'; includeLimit?: boolean } = {},
): string {
  const query = new URLSearchParams({ view });
  if (options.includeLimit !== false) {
    query.set('limit', String(filters.pageSize || 20));
  }
  if (options.format) {
    query.set('format', options.format);
    query.set('exportLimit', String(filters.exportLimit || 1));
  }
  if (cursor) query.set('cursor', cursor);
  if (filters.actorQuery.trim()) query.set('actor', filters.actorQuery.trim());
  if (filters.settingKey.trim()) query.set('key', filters.settingKey.trim());
  if (filters.dateFrom.trim()) query.set('dateFrom', filters.dateFrom.trim());
  if (filters.dateTo.trim()) query.set('dateTo', filters.dateTo.trim());
  return query.toString();
}

export function normalizeSettingsBootstrap(data: unknown) {
  const source = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const auditMeta = normalizeSettingsAuditMeta(source.auditCapabilities);
  return {
    config: (source.settings && typeof source.settings === 'object') ? (source.settings as Record<string, string>) : {},
    canEditConfig: Boolean(source.canEdit),
    canViewAudit: Boolean(source.canViewAudit),
    canPurgeBranch: Boolean(source.canPurgeBranch),
    branchPurgeTargets: Array.isArray(source.branchPurgeTargets) ? (source.branchPurgeTargets as BranchPurgeTarget[]) : [],
    purgeModuleKeys: Array.isArray(source.purgeModuleKeys) ? source.purgeModuleKeys.map((item) => String(item)) : [],
    auditMeta,
  };
}

export function normalizeSettingsAuditPage(data: unknown, fallbackMeta: SettingsAuditMeta) {
  const source = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const meta = normalizeSettingsAuditMeta(source.meta || fallbackMeta);
  return {
    items: Array.isArray(source.items) ? (source.items as SettingsAuditEntry[]) : [],
    nextCursor: typeof source.nextCursor === 'string' && source.nextCursor ? source.nextCursor : null,
    meta,
  };
}

export function normalizeSettingsAuditExportHistoryPage(data: unknown, fallbackMeta: SettingsAuditMeta) {
  const source = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
  const meta = normalizeSettingsAuditMeta(source.meta || fallbackMeta);
  return {
    items: Array.isArray(source.items) ? (source.items as SettingsAuditExportEntry[]) : [],
    nextCursor: typeof source.nextCursor === 'string' && source.nextCursor ? source.nextCursor : null,
    meta,
  };
}
