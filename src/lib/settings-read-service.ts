import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import {
  editableSystemSettingKeys,
  getSystemSettingsWithDefaults,
} from '@/lib/system-settings';
import { getUserImageCompressionPreference, type UserImageCompressionPreference } from '@/lib/user-preference-service';

const purgeModuleKeys = ['invoice', 'receipt', 'detail', 'swift', 'customer', 'all'] as const;
type PurgeModuleKey = typeof purgeModuleKeys[number];
const SETTINGS_AUDIT_PAGE_SIZE = 20;
const SETTINGS_AUDIT_MAX_PAGE_SIZE_FALLBACK = 100;
const SETTINGS_AUDIT_EXPORT_MAX_ROWS_FALLBACK = 5000;

type BranchPurgeTarget = {
  id: string;
  email: string;
  name: string | null;
  level: number;
  role: UserRole;
  parentId: string | null;
};

export type SystemSettingsAuditChange = {
  key: string;
  before: string;
  after: string;
};

export type SystemSettingsAuditEntry = {
  id: string;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  updatedKeys: string[];
  changes: SystemSettingsAuditChange[];
};

export type SystemSettingsAuditExportEntry = {
  id: string;
  createdAt: string;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
  rowCount: number;
  exportLimit: number;
  maxExportRows: number;
  truncated: boolean;
  filterActor: string;
  filterKey: string;
  filterDateFrom: string;
  filterDateTo: string;
  exportedKeys: string[];
};

export type SystemSettingsAuditFilters = {
  cursor?: string | null;
  limit?: number;
  exportLimit?: number;
  actor?: string | null;
  key?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type SystemSettingsAuditCapabilities = {
  defaultPageSize: number;
  maxPageSize: number;
  maxExportRows: number;
  pageSizeOptions: number[];
  cursorMode: 'id';
};

type AuditActor = {
  id: string;
  email: string;
  name: string | null;
} | null;

type RawAuditRow = {
  id: string;
  createdAt: Date;
  metadata: unknown;
  actor: AuditActor;
};

type NormalizedSystemSettingsAuditFilters = {
  limit: number;
  exportLimit: number;
  actorQuery: string;
  keyQuery: string;
  dateFrom: Date | null;
  dateTo: Date | null;
};

function assertAdmin(currentUser: CurrentUser, message: string): void {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({
      code: 'FORBIDDEN',
      status: 403,
      message,
      detail: { role: currentUser.role },
    });
  }
}

function normalizeAuditChanges(metadata: unknown): SystemSettingsAuditChange[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const changes = (metadata as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const key = typeof row.key === 'string' ? row.key : '';
      if (!key) return null;
      return {
        key,
        before: typeof row.before === 'string' ? row.before : '',
        after: typeof row.after === 'string' ? row.after : '',
      };
    })
    .filter((item): item is SystemSettingsAuditChange => Boolean(item));
}

function normalizeAuditUpdatedKeys(metadata: unknown, changes: SystemSettingsAuditChange[]): string[] {
  if (metadata && typeof metadata === 'object') {
    const updatedKeys = (metadata as { updatedKeys?: unknown }).updatedKeys;
    if (Array.isArray(updatedKeys)) {
      const keys = updatedKeys.map((item) => String(item || '').trim()).filter(Boolean);
      if (keys.length > 0) return keys;
    }
  }
  return changes.map((item) => item.key);
}

function normalizeAuditExportedKeys(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const exportedKeys = (metadata as { exportedKeys?: unknown }).exportedKeys;
  if (!Array.isArray(exportedKeys)) return [];
  return exportedKeys.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeAuditExportCount(metadata: unknown, key: 'rowCount' | 'exportLimit' | 'maxExportRows'): number {
  if (!metadata || typeof metadata !== 'object') return 0;
  const value = (metadata as Record<string, unknown>)[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeAuditExportFilterValue(metadata: unknown, key: 'actor' | 'key' | 'dateFrom' | 'dateTo'): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const filters = (metadata as { filters?: unknown }).filters;
  if (!filters || typeof filters !== 'object') return '';
  return String((filters as Record<string, unknown>)[key] || '').trim();
}

function normalizeAuditExportTruncated(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as { truncated?: unknown }).truncated);
}

function parseAuditDateInput(value: string | null | undefined, label: string, endOfRange = false): Date | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const raw = normalized.includes('T')
    ? normalized
    : `${normalized}${endOfRange ? 'T23:59:59.999' : 'T00:00:00.000'}`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `${label} 格式错误`,
      detail: { value: normalized },
    });
  }
  return date;
}

function matchesAuditKeyFilter(metadata: unknown, keyQuery: string): boolean {
  if (!keyQuery) return true;
  const normalizedKey = keyQuery.toLowerCase();
  const changes = normalizeAuditChanges(metadata);
  const updatedKeys = normalizeAuditUpdatedKeys(metadata, changes);
  return updatedKeys.some((key) => key.toLowerCase().includes(normalizedKey))
    || changes.some((change) => change.key.toLowerCase().includes(normalizedKey));
}

function matchesAuditExportKeyFilter(metadata: unknown, keyQuery: string): boolean {
  if (!keyQuery) return true;
  const normalizedKey = keyQuery.toLowerCase();
  const filterKey = normalizeAuditExportFilterValue(metadata, 'key').toLowerCase();
  const exportedKeys = normalizeAuditExportedKeys(metadata).map((key) => key.toLowerCase());
  return filterKey.includes(normalizedKey) || exportedKeys.some((key) => key.includes(normalizedKey));
}

function matchesAuditActorFilter(actor: AuditActor, actorQuery: string): boolean {
  if (!actorQuery) return true;
  if (!actor) return false;
  const normalized = actorQuery.toLowerCase();
  return actor.id === actorQuery
    || actor.email.toLowerCase().includes(normalized)
    || String(actor.name || '').toLowerCase().includes(normalized);
}

function matchesAuditDateFilter(createdAt: Date, dateFrom: Date | null, dateTo: Date | null): boolean {
  if (dateFrom && createdAt.getTime() < dateFrom.getTime()) return false;
  if (dateTo && createdAt.getTime() > dateTo.getTime()) return false;
  return true;
}

function clampPositiveInt(value: number, fallback: number, min = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(Math.trunc(value), min);
}

function buildPageSizeOptions(maxPageSize: number): number[] {
  const candidates = [20, 50, 100, maxPageSize]
    .map((value) => clampPositiveInt(value, SETTINGS_AUDIT_PAGE_SIZE))
    .filter((value) => value <= maxPageSize);
  const unique = Array.from(new Set(candidates)).sort((a, b) => a - b);
  return unique.length > 0 ? unique : [maxPageSize];
}

function buildSettingsAuditCapabilities(settings: Partial<Record<string, string>>): SystemSettingsAuditCapabilities {
  const maxPageSize = clampPositiveInt(
    Number(settings.SETTINGS_AUDIT_MAX_PAGE_SIZE),
    SETTINGS_AUDIT_MAX_PAGE_SIZE_FALLBACK,
  );
  const maxExportRows = clampPositiveInt(
    Number(settings.SETTINGS_AUDIT_EXPORT_MAX_ROWS),
    SETTINGS_AUDIT_EXPORT_MAX_ROWS_FALLBACK,
  );

  return {
    defaultPageSize: Math.min(SETTINGS_AUDIT_PAGE_SIZE, maxPageSize),
    maxPageSize,
    maxExportRows,
    pageSizeOptions: buildPageSizeOptions(maxPageSize),
    cursorMode: 'id',
  };
}

async function getSettingsAuditCapabilities(): Promise<SystemSettingsAuditCapabilities> {
  const settings = await getSystemSettingsWithDefaults([
    'SETTINGS_AUDIT_MAX_PAGE_SIZE',
    'SETTINGS_AUDIT_EXPORT_MAX_ROWS',
  ]);
  return buildSettingsAuditCapabilities(settings);
}

function normalizeSystemSettingsAuditFilters(
  options: SystemSettingsAuditFilters,
  capabilities: SystemSettingsAuditCapabilities,
): NormalizedSystemSettingsAuditFilters {
  const limit = Math.min(
    Math.max(Number(options.limit) || SETTINGS_AUDIT_PAGE_SIZE, 1),
    capabilities.maxPageSize,
  );
  const exportLimit = Math.min(
    Math.max(Number(options.exportLimit) || capabilities.maxExportRows, 1),
    capabilities.maxExportRows,
  );
  const actorQuery = String(options.actor || '').trim();
  const keyQuery = String(options.key || '').trim();
  const dateFrom = parseAuditDateInput(options.dateFrom, 'dateFrom');
  const dateTo = parseAuditDateInput(options.dateTo, 'dateTo', true);

  if (dateFrom && dateTo && dateTo.getTime() < dateFrom.getTime()) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '结束时间不能早于开始时间',
      detail: {
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
      },
    });
  }

  return { limit, exportLimit, actorQuery, keyQuery, dateFrom, dateTo };
}

async function collectSystemSettingsAuditRows(
  currentUser: CurrentUser,
  options: SystemSettingsAuditFilters,
  targetCount: number,
  capabilities: SystemSettingsAuditCapabilities | undefined,
  where: Prisma.AuditLogWhereInput,
  matchesMetadata: (metadata: unknown, keyQuery: string) => boolean,
): Promise<RawAuditRow[]> {
  assertAdmin(currentUser, '只有管理员可以查看系统配置审计');

  const resolvedCapabilities = capabilities || await getSettingsAuditCapabilities();
  const { actorQuery, keyQuery, dateFrom, dateTo } = normalizeSystemSettingsAuditFilters(options, resolvedCapabilities);

  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    };
  }

  if (actorQuery) {
    where.actor = {
      is: {
        OR: [
          { id: actorQuery },
          { email: { contains: actorQuery } },
          { name: { contains: actorQuery } },
        ],
      },
    };
  }
  const take = Math.max(Math.min(targetCount * 3, 200), 50);
  const filteredRows: RawAuditRow[] = [];

  let cursor = options.cursor || null;
  let exhausted = false;
  while (filteredRows.length < targetCount && !exhausted) {
    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        createdAt: true,
        metadata: true,
        actor: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (rows.length === 0) break;
    filteredRows.push(...rows.filter((row) => (
      matchesAuditActorFilter(row.actor, actorQuery)
      && matchesAuditDateFilter(row.createdAt, dateFrom, dateTo)
      && matchesMetadata(row.metadata, keyQuery)
    )));
    cursor = rows[rows.length - 1]?.id || null;
    exhausted = rows.length < take;
  }

  return filteredRows;
}

function mapSystemSettingsAuditEntry(row: RawAuditRow): SystemSettingsAuditEntry {
  const changes = normalizeAuditChanges(row.metadata);
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
    updatedKeys: normalizeAuditUpdatedKeys(row.metadata, changes),
    changes,
  };
}

function mapSystemSettingsAuditExportEntry(row: RawAuditRow): SystemSettingsAuditExportEntry {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
    rowCount: normalizeAuditExportCount(row.metadata, 'rowCount'),
    exportLimit: normalizeAuditExportCount(row.metadata, 'exportLimit'),
    maxExportRows: normalizeAuditExportCount(row.metadata, 'maxExportRows'),
    truncated: normalizeAuditExportTruncated(row.metadata),
    filterActor: normalizeAuditExportFilterValue(row.metadata, 'actor'),
    filterKey: normalizeAuditExportFilterValue(row.metadata, 'key'),
    filterDateFrom: normalizeAuditExportFilterValue(row.metadata, 'dateFrom'),
    filterDateTo: normalizeAuditExportFilterValue(row.metadata, 'dateTo'),
    exportedKeys: normalizeAuditExportedKeys(row.metadata),
  };
}

export async function listSettings(currentUser: CurrentUser): Promise<{
  settings: Record<string, string>;
  editableKeys: readonly string[];
  canEdit: boolean;
  branchPurgeTargets: BranchPurgeTarget[];
  canPurgeBranch: boolean;
  purgeModuleKeys: readonly PurgeModuleKey[];
  canViewAudit: boolean;
  auditCapabilities: SystemSettingsAuditCapabilities;
}> {
  const settings = await getSystemSettingsWithDefaults(editableSystemSettingKeys);
  const auditCapabilities = buildSettingsAuditCapabilities(settings);

  let branchPurgeTargets: BranchPurgeTarget[] = [];
  if (currentUser.role === UserRole.ADMIN) {
    branchPurgeTargets = await db.user.findMany({
      select: { id: true, email: true, name: true, level: true, role: true, parentId: true },
      orderBy: [{ level: 'asc' }, { role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  await recordAuditEvent({
    action: auditActions.SYSTEM_SETTINGS_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SYSTEM_SETTING,
    metadata: {
      editableKeyCount: editableSystemSettingKeys.length,
      branchPurgeTargetCount: branchPurgeTargets.length,
      canEdit: currentUser.role === UserRole.ADMIN,
      canViewAudit: currentUser.role === UserRole.ADMIN,
    },
  });

  return {
    settings,
    editableKeys: editableSystemSettingKeys,
    canEdit: currentUser.role === UserRole.ADMIN,
    branchPurgeTargets,
    canPurgeBranch: currentUser.role === UserRole.ADMIN,
    purgeModuleKeys,
    canViewAudit: currentUser.role === UserRole.ADMIN,
    auditCapabilities,
  };
}

export async function getCurrentUserImageCompressionPreferences(
  currentUser: CurrentUser
): Promise<UserImageCompressionPreference> {
  return getUserImageCompressionPreference(currentUser);
}

export async function listSystemSettingsAuditLogs(
  currentUser: CurrentUser,
  options: SystemSettingsAuditFilters = {}
): Promise<{
  items: SystemSettingsAuditEntry[];
  nextCursor: string | null;
  limit: number;
  meta: SystemSettingsAuditCapabilities;
}> {
  const capabilities = await getSettingsAuditCapabilities();
  const { limit } = normalizeSystemSettingsAuditFilters(options, capabilities);
  const filteredRows = await collectSystemSettingsAuditRows(
    currentUser,
    options,
    limit + 1,
    capabilities,
    {
      action: auditActions.SYSTEM_SETTINGS_UPDATE,
      targetType: auditTargetTypes.SYSTEM_SETTING,
    },
    matchesAuditKeyFilter,
  );
  const hasMore = filteredRows.length > limit;
  const items = filteredRows.slice(0, limit).map(mapSystemSettingsAuditEntry);

  await recordAuditEvent({
    action: auditActions.SYSTEM_SETTINGS_AUDIT_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SYSTEM_SETTING,
    metadata: {
      rowCount: items.length,
      limit,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
      filters: {
        actor: String(options.actor || '').trim(),
        key: String(options.key || '').trim(),
        dateFrom: String(options.dateFrom || '').trim(),
        dateTo: String(options.dateTo || '').trim(),
      },
    },
  });

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    limit,
    meta: capabilities,
  };
}

export async function listAllSystemSettingsAuditLogs(
  currentUser: CurrentUser,
  options: Omit<SystemSettingsAuditFilters, 'cursor' | 'limit'> = {},
): Promise<{
  items: SystemSettingsAuditEntry[];
  exportLimit: number;
  maxExportRows: number;
  truncated: boolean;
}> {
  const capabilities = await getSettingsAuditCapabilities();
  const normalizedFilters = normalizeSystemSettingsAuditFilters(options, capabilities);
  const { exportLimit } = normalizedFilters;
  const filteredRows = await collectSystemSettingsAuditRows(
    currentUser,
    options,
    exportLimit + 1,
    capabilities,
    {
      action: auditActions.SYSTEM_SETTINGS_UPDATE,
      targetType: auditTargetTypes.SYSTEM_SETTING,
    },
    matchesAuditKeyFilter,
  );
  const truncated = filteredRows.length > exportLimit;
  const items = filteredRows.slice(0, exportLimit).map(mapSystemSettingsAuditEntry);
  await recordAuditEvent({
    action: auditActions.SYSTEM_SETTINGS_AUDIT_EXPORT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SYSTEM_SETTING,
    metadata: {
      rowCount: items.length,
      exportLimit,
      maxExportRows: capabilities.maxExportRows,
      truncated,
      exportedKeys: Array.from(new Set(items.flatMap((item) => item.updatedKeys))).sort(),
      filters: {
        actor: normalizedFilters.actorQuery,
        key: normalizedFilters.keyQuery,
        dateFrom: options.dateFrom || '',
        dateTo: options.dateTo || '',
      },
    },
  });
  return {
    items,
    exportLimit,
    maxExportRows: capabilities.maxExportRows,
    truncated,
  };
}

export async function listSystemSettingsAuditExportLogs(
  currentUser: CurrentUser,
  options: SystemSettingsAuditFilters = {},
): Promise<{
  items: SystemSettingsAuditExportEntry[];
  nextCursor: string | null;
  limit: number;
  meta: SystemSettingsAuditCapabilities;
}> {
  const capabilities = await getSettingsAuditCapabilities();
  const { limit } = normalizeSystemSettingsAuditFilters(options, capabilities);
  const filteredRows = await collectSystemSettingsAuditRows(
    currentUser,
    options,
    limit + 1,
    capabilities,
    {
      action: auditActions.SYSTEM_SETTINGS_AUDIT_EXPORT,
      targetType: auditTargetTypes.SYSTEM_SETTING,
    },
    matchesAuditExportKeyFilter,
  );
  const hasMore = filteredRows.length > limit;
  const items = filteredRows.slice(0, limit).map(mapSystemSettingsAuditExportEntry);

  await recordAuditEvent({
    action: auditActions.SYSTEM_SETTINGS_AUDIT_EXPORT_HISTORY_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SYSTEM_SETTING,
    metadata: {
      rowCount: items.length,
      limit,
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
      filters: {
        actor: String(options.actor || '').trim(),
        key: String(options.key || '').trim(),
        dateFrom: String(options.dateFrom || '').trim(),
        dateTo: String(options.dateTo || '').trim(),
      },
    },
  });

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    limit,
    meta: capabilities,
  };
}
