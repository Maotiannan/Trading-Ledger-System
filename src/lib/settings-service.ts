import { DeletionTargetType, Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { testOcrConnectivity } from '@/lib/ocr';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { runInTransaction } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';
import {
  booleanSystemSettingKeys,
  editableSystemSettingKeys,
  getSystemSettingsWithDefaults,
  invalidateSystemSettingsCache,
  numericSystemSettingMinimums,
  secretSystemSettingKeys,
} from '@/lib/system-settings';

const purgeModuleKeys = ['invoice', 'receipt', 'detail', 'swift', 'customer', 'all'] as const;
type PurgeModuleKey = typeof purgeModuleKeys[number];
type SelectedPurgeModule = Exclude<PurgeModuleKey, 'all'>;
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

function matchesAuditActorFilter(
  actor: { id: string; email: string; name: string | null } | null,
  actorQuery: string,
): boolean {
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

type NormalizedSystemSettingsAuditFilters = {
  limit: number;
  exportLimit: number;
  actorQuery: string;
  keyQuery: string;
  dateFrom: Date | null;
  dateTo: Date | null;
};

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

function normalizePurgeModules(value: unknown): Set<SelectedPurgeModule> {
  const raw = Array.isArray(value) ? value : [];
  const normalized = new Set<PurgeModuleKey>();
  for (const item of raw) {
    const key = String(item || '').trim().toLowerCase() as PurgeModuleKey;
    if (purgeModuleKeys.includes(key)) normalized.add(key);
  }
  if (normalized.has('all')) {
    return new Set<SelectedPurgeModule>(['invoice', 'receipt', 'detail', 'swift', 'customer']);
  }
  return new Set(
    Array.from(normalized).filter((key): key is SelectedPurgeModule => key !== 'all')
  );
}

async function getBranchUserIds(rootUserId: string): Promise<string[]> {
  const users = await db.user.findMany({
    select: { id: true, parentId: true },
  });
  const children = new Map<string, string[]>();
  for (const user of users) {
    if (!user.parentId) continue;
    if (!children.has(user.parentId)) children.set(user.parentId, []);
    children.get(user.parentId)!.push(user.id);
  }

  const seen = new Set<string>([rootUserId]);
  const queue: string[] = [rootUserId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const childIds = children.get(current) || [];
    for (const childId of childIds) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
    }
  }
  return Array.from(seen);
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
  capabilities?: SystemSettingsAuditCapabilities,
): Promise<Array<{
  id: string;
  createdAt: Date;
  metadata: unknown;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}>> {
  assertAdmin(currentUser, '只有管理员可以查看系统配置审计');

  const resolvedCapabilities = capabilities || await getSettingsAuditCapabilities();
  const { actorQuery, keyQuery, dateFrom, dateTo } = normalizeSystemSettingsAuditFilters(options, resolvedCapabilities);
  const where: Prisma.AuditLogWhereInput = {
    action: auditActions.SYSTEM_SETTINGS_UPDATE,
    targetType: auditTargetTypes.SYSTEM_SETTING,
  };

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
  const filteredRows: Array<{
    id: string;
    createdAt: Date;
    metadata: unknown;
    actor: {
      id: string;
      email: string;
      name: string | null;
    } | null;
  }> = [];

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
      && matchesAuditKeyFilter(row.metadata, keyQuery)
    )));
    cursor = rows[rows.length - 1]?.id || null;
    exhausted = rows.length < take;
  }

  return filteredRows;
}

function mapSystemSettingsAuditEntry(row: {
  id: string;
  createdAt: Date;
  metadata: unknown;
  actor: {
    id: string;
    email: string;
    name: string | null;
  } | null;
}): SystemSettingsAuditEntry {
  const changes = normalizeAuditChanges(row.metadata);
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
    updatedKeys: normalizeAuditUpdatedKeys(row.metadata, changes),
    changes,
  };
}

function validateBooleanSetting(key: string, value: string): void {
  if (value !== 'true' && value !== 'false') {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `${key} 必须为 true 或 false`,
      detail: { key, value },
    });
  }
}

function validateNumericSetting(key: string, value: string, min: number): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `${key} 必须为不小于 ${min} 的数字`,
      detail: { key, value, min },
    });
  }
}

async function validateSettingUpdates(
  settings: Record<string, unknown>,
  currentSettings: Record<string, string>
): Promise<Array<{ key: string; value: string }>> {
  const updates = editableSystemSettingKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(settings, key))
    .map((key) => ({
      key,
      value: String(settings[key] ?? ''),
    }));

  for (const item of updates) {
    if ((booleanSystemSettingKeys as readonly string[]).includes(item.key)) {
      validateBooleanSetting(item.key, item.value);
      continue;
    }
    const min = numericSystemSettingMinimums[item.key as keyof typeof numericSystemSettingMinimums];
    if (typeof min === 'number') {
      validateNumericSetting(item.key, item.value, min);
    }
  }

  const merged = { ...currentSettings };
  for (const update of updates) {
    merged[update.key as keyof typeof merged] = update.value;
  }

  const warningTolerance = Number(merged.SWIFT_WARNING_TOLERANCE);
  const rejectTolerance = Number(merged.SWIFT_REJECT_TOLERANCE);
  if (Number.isFinite(warningTolerance) && Number.isFinite(rejectTolerance) && rejectTolerance < warningTolerance) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: 'SWIFT_REJECT_TOLERANCE 不能小于 SWIFT_WARNING_TOLERANCE',
      detail: {
        SWIFT_WARNING_TOLERANCE: merged.SWIFT_WARNING_TOLERANCE,
        SWIFT_REJECT_TOLERANCE: merged.SWIFT_REJECT_TOLERANCE,
      },
    });
  }

  return updates;
}

function normalizeSettingAuditValue(key: string, value: string): string {
  if ((secretSystemSettingKeys as readonly string[]).includes(key)) {
    return value ? '[masked]' : '';
  }
  return value;
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
  const filteredRows = await collectSystemSettingsAuditRows(currentUser, options, limit + 1, capabilities);
  const hasMore = filteredRows.length > limit;
  const items = filteredRows.slice(0, limit).map(mapSystemSettingsAuditEntry);

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
  const { exportLimit } = normalizeSystemSettingsAuditFilters(options, capabilities);
  const filteredRows = await collectSystemSettingsAuditRows(currentUser, options, exportLimit + 1, capabilities);
  const truncated = filteredRows.length > exportLimit;
  return {
    items: filteredRows.slice(0, exportLimit).map(mapSystemSettingsAuditEntry),
    exportLimit,
    maxExportRows: capabilities.maxExportRows,
    truncated,
  };
}

export async function testSettingsOcr(currentUser: CurrentUser): Promise<{
  message: string;
  detail: string;
}> {
  assertAdmin(currentUser, '只有管理员可以测试OCR配置');

  const result = await testOcrConnectivity();
  if (!result.success) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: result.message,
      detail: result.detail || '',
    });
  }

  return {
    message: result.message,
    detail: result.detail || '',
  };
}

export async function purgeBusinessData(currentUser: CurrentUser): Promise<{ message: string }> {
  assertAdmin(currentUser, '只有管理员可以清空业务数据');

  await runInTransaction(async (tx) => {
    await tx.detailItem.deleteMany({});
    await tx.receiptHistory.deleteMany({});
    await tx.detailHistory.deleteMany({});
    await tx.balanceTransfer.deleteMany({});
    await tx.swift.deleteMany({});
    await tx.receipt.deleteMany({});
    await tx.detail.deleteMany({});
    await tx.order.deleteMany({});
    await tx.invoice.deleteMany({});
    await tx.customer.deleteMany({});
    await tx.deletionRequest.deleteMany({});
    await tx.auditLog.deleteMany({});
  });

  return { message: '业务数据已清空（系统配置/用户数据保留）' };
}

export async function purgeBranchBusinessData(
  currentUser: CurrentUser,
  payload: {
    targetUserId?: string | null;
    targetAdminId?: string | null;
    password?: string | null;
    modules?: unknown;
  }
): Promise<{
  message: string;
  data: {
    targetUser: string;
    targetRole: UserRole;
    branchUsers: number;
    modules: SelectedPurgeModule[];
    deletedOrders: number;
    deletedInvoices: number;
    deletedReceipts: number;
    deletedDetails: number;
    deletedSwifts: number;
    deletedCustomers: number;
  };
}> {
  assertAdmin(currentUser, '只有管理员可执行分支清库');

  const targetUserId = typeof payload.targetUserId === 'string'
    ? payload.targetUserId.trim()
    : (typeof payload.targetAdminId === 'string' ? payload.targetAdminId.trim() : '');
  const password = typeof payload.password === 'string' ? payload.password : '';
  const selectedModules = normalizePurgeModules(payload.modules);

  if (!targetUserId || !password) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '缺少目标账号或密码',
    });
  }
  if (selectedModules.size === 0) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '至少选择一个清理模块',
    });
  }

  const currentWithPassword = await db.user.findUnique({
    where: { id: currentUser.id },
    select: { id: true, password: true },
  });
  if (!currentWithPassword || !(await verifyPassword(password, currentWithPassword.password))) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '密码错误',
    });
  }

  const targetUser = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, email: true, name: true, level: true },
  });
  if (!targetUser) {
    throw createApiError({
      code: 'RESOURCE_NOT_FOUND',
      status: 400,
      message: '目标账户不存在',
      detail: { targetUserId },
    });
  }

  const branchUserIds = await getBranchUserIds(targetUser.id);

  const [orders, invoices, receipts, details, swifts, customers] = await Promise.all([
    db.order.findMany({
      where: { createdBy: { in: branchUserIds } },
      select: { id: true, invoiceId: true },
    }),
    db.invoice.findMany({
      where: { createdBy: { in: branchUserIds } },
      select: { id: true },
    }),
    db.receipt.findMany({
      where: { createdBy: { in: branchUserIds } },
      select: { id: true },
    }),
    db.detail.findMany({
      where: { createdBy: { in: branchUserIds } },
      select: { id: true },
    }),
    db.swift.findMany({
      where: { createdBy: { in: branchUserIds } },
      select: { id: true, detailId: true },
    }),
    db.customer.findMany({
      where: {
        OR: [
          { createdBy: { in: branchUserIds } },
          { ownerId: { in: branchUserIds } },
        ],
      },
      select: { id: true },
    }),
  ]);

  const orderIds = orders.map((row) => row.id);
  const receiptIds = receipts.map((row) => row.id);
  const detailIds = details.map((row) => row.id);
  const swiftIdsCreatedByBranch = swifts.map((row) => row.id);
  const customerIds = customers.map((row) => row.id);

  const modules = {
    invoice: selectedModules.has('invoice'),
    receipt: selectedModules.has('receipt'),
    detail: selectedModules.has('detail'),
    swift: selectedModules.has('swift'),
    customer: selectedModules.has('customer'),
  };

  const selectedOrderIds = modules.invoice ? orderIds : [];
  const selectedReceiptIds = modules.receipt ? receiptIds : [];
  const selectedDetailIds = modules.detail ? detailIds : [];
  const selectedDetailIdSet = new Set(selectedDetailIds);
  const selectedSwiftIds = Array.from(new Set([
    ...(modules.swift ? swiftIdsCreatedByBranch : []),
    ...(modules.detail
      ? swifts.filter((row) => row.detailId && selectedDetailIdSet.has(row.detailId)).map((row) => row.id)
      : []),
  ]));
  const selectedCustomerIds = modules.customer ? customerIds : [];
  const selectedInvoiceIds = modules.invoice
    ? Array.from(new Set([...invoices.map((row) => row.id), ...orders.map((row) => row.invoiceId)]))
    : [];

  await runInTransaction(async (tx) => {
    if (selectedReceiptIds.length > 0) {
      await tx.detailItem.updateMany({
        where: { receiptId: { in: selectedReceiptIds } },
        data: { receiptId: null },
      });
    }

    if (selectedOrderIds.length > 0) {
      await tx.receipt.updateMany({
        where: { orderId: { in: selectedOrderIds } },
        data: { orderId: null },
      });
      await tx.balanceTransfer.deleteMany({
        where: {
          OR: [
            { fromOrderId: { in: selectedOrderIds } },
            { toOrderId: { in: selectedOrderIds } },
          ],
        },
      });
    }

    if (selectedDetailIds.length > 0) {
      await tx.detailHistory.deleteMany({
        where: { detailId: { in: selectedDetailIds } },
      });
    }

    if (selectedReceiptIds.length > 0) {
      await tx.receiptHistory.deleteMany({
        where: { receiptId: { in: selectedReceiptIds } },
      });
    }

    if (selectedSwiftIds.length > 0) {
      await tx.swift.deleteMany({ where: { id: { in: selectedSwiftIds } } });
    }
    if (selectedDetailIds.length > 0) {
      await tx.detail.deleteMany({ where: { id: { in: selectedDetailIds } } });
    }
    if (selectedReceiptIds.length > 0) {
      await tx.receipt.deleteMany({ where: { id: { in: selectedReceiptIds } } });
    }
    if (selectedOrderIds.length > 0) {
      await tx.order.deleteMany({ where: { id: { in: selectedOrderIds } } });
    }
    if (selectedInvoiceIds.length > 0) {
      await tx.invoice.deleteMany({
        where: {
          id: { in: selectedInvoiceIds },
          orders: { none: {} },
        },
      });
    }
    if (selectedCustomerIds.length > 0) {
      await tx.customer.deleteMany({ where: { id: { in: selectedCustomerIds } } });
    }

    await tx.deletionRequest.deleteMany({
      where: {
        OR: [
          { requestedBy: { in: branchUserIds } },
          { approvedBy: { in: branchUserIds } },
          ...(selectedReceiptIds.length > 0 ? [{ targetType: DeletionTargetType.RECEIPT, targetId: { in: selectedReceiptIds } }] : []),
          ...(selectedDetailIds.length > 0 ? [{ targetType: DeletionTargetType.DETAIL, targetId: { in: selectedDetailIds } }] : []),
          ...(selectedSwiftIds.length > 0 ? [{ targetType: DeletionTargetType.SWIFT, targetId: { in: selectedSwiftIds } }] : []),
        ],
      },
    });

    await tx.auditLog.deleteMany({
      where: { actorId: { in: branchUserIds } },
    });
  });

  return {
    message: `已清空账号 ${targetUser.email} 分支业务数据（系统配置/用户配置保留）`,
    data: {
      targetUser: targetUser.email,
      targetRole: targetUser.role,
      branchUsers: branchUserIds.length,
      modules: Array.from(selectedModules),
      deletedOrders: selectedOrderIds.length,
      deletedInvoices: selectedInvoiceIds.length,
      deletedReceipts: selectedReceiptIds.length,
      deletedDetails: selectedDetailIds.length,
      deletedSwifts: selectedSwiftIds.length,
      deletedCustomers: selectedCustomerIds.length,
    },
  };
}

export async function updateSystemSettings(
  currentUser: CurrentUser,
  settings: unknown
): Promise<{ message: string }> {
  assertAdmin(currentUser, '只有管理员可以修改系统配置');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '配置参数无效',
    });
  }

  const currentSettings = await getSystemSettingsWithDefaults(editableSystemSettingKeys);
  const updates = await validateSettingUpdates(settings as Record<string, unknown>, currentSettings);
  if (updates.length === 0) {
    return { message: '无变更' };
  }

  const changeSet = updates.map((item) => ({
    key: item.key,
    before: normalizeSettingAuditValue(item.key, currentSettings[item.key as keyof typeof currentSettings] ?? ''),
    after: normalizeSettingAuditValue(item.key, item.value),
  }));

  await runInTransaction(async (tx) => {
    for (const item of updates) {
      await tx.systemSetting.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          value: item.value,
          updatedBy: currentUser.id,
        },
        update: {
          value: item.value,
          updatedBy: currentUser.id,
        },
      });
    }
  });

  invalidateSystemSettingsCache();
  await recordAuditEvent({
    action: auditActions.SYSTEM_SETTINGS_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.SYSTEM_SETTING,
    metadata: {
      updatedKeys: updates.map((item) => item.key),
      changes: changeSet,
    },
  });
  return { message: '配置已更新' };
}
