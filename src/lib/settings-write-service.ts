import { DeletionTargetType, UserRole } from '@prisma/client';
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
  customerAnalyticsSystemSettingKeys,
  editableSystemSettingKeys,
  getSystemSettingsWithDefaults,
  integerSystemSettingKeys,
  invalidateSystemSettingsCache,
  numericSystemSettingMaximums,
  numericSystemSettingMinimums,
  secretSystemSettingKeys,
} from '@/lib/system-settings';
import { parseCustomerAnalyticsSettings } from '@/lib/customer-analytics-settings';
import {
  updateUserImageCompressionPreference,
  type UserImageCompressionPreference,
  updateUserPreferences,
  type UserPreferenceSettings,
} from '@/lib/user-preference-service';

const purgeModuleKeys = ['invoice', 'receipt', 'detail', 'swift', 'customer', 'all'] as const;
type PurgeModuleKey = typeof purgeModuleKeys[number];
type SelectedPurgeModule = Exclude<PurgeModuleKey, 'all'>;

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

function validateNumericSetting(
  key: string,
  value: string,
  min: number,
  max?: number,
  integerOnly = false,
): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: max === undefined
        ? `${key} 必须为不小于 ${min} 的数字`
        : `${key} 必须为 ${min} 至 ${max} 之间的数字`,
      detail: { key, value, min, ...(max === undefined ? {} : { max }) },
    });
  }
  if (integerOnly && !Number.isInteger(parsed)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: `${key} 必须为整数`,
      detail: { key, value },
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

  const analyticsUpdates = updates.filter((item) => (
    (customerAnalyticsSystemSettingKeys as readonly string[]).includes(item.key)
  ));
  if (analyticsUpdates.length > 0 && analyticsUpdates.length !== customerAnalyticsSystemSettingKeys.length) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '客户分析配置必须整组保存，请同时提交全部七项规则',
      detail: {
        requiredKeys: customerAnalyticsSystemSettingKeys,
        submittedKeys: analyticsUpdates.map((item) => item.key),
      },
    });
  }

  for (const item of updates) {
    if ((booleanSystemSettingKeys as readonly string[]).includes(item.key)) {
      validateBooleanSetting(item.key, item.value);
      continue;
    }
    const min = numericSystemSettingMinimums[item.key as keyof typeof numericSystemSettingMinimums];
    if (typeof min === 'number') {
      const max = numericSystemSettingMaximums[item.key as keyof typeof numericSystemSettingMaximums];
      validateNumericSetting(
        item.key,
        item.value,
        min,
        max,
        (integerSystemSettingKeys as readonly string[]).includes(item.key),
      );
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

  if (analyticsUpdates.length > 0) {
    const analyticsUpdateMap = new Map(analyticsUpdates.map((item) => [item.key, item.value]));
    const analyticsSettings = Object.fromEntries(
      customerAnalyticsSystemSettingKeys.map((key) => [key, analyticsUpdateMap.get(key) || '']),
    ) as Record<string, string>;
    if (!parseCustomerAnalyticsSettings(analyticsSettings)) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: '客户分析天数必须按正常、轻微拖延、拖延、警告、加倍警告、严重警告严格递增',
        detail: analyticsSettings,
      });
    }
  }

  return updates;
}

function normalizeSettingAuditValue(key: string, value: string): string {
  if ((secretSystemSettingKeys as readonly string[]).includes(key)) {
    return value ? '[masked]' : '';
  }
  return value;
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

export async function updateCurrentUserImageCompressionPreferences(
  currentUser: CurrentUser,
  payload: unknown
): Promise<{
  message: string;
  preferences: UserImageCompressionPreference;
}> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '用户偏好格式错误',
      detail: { payload },
    });
  }

  const preferences = await updateUserImageCompressionPreference(
    currentUser,
    payload as Partial<UserImageCompressionPreference>,
  );

  return {
    message: '用户偏好已更新',
    preferences,
  };
}

export async function updateCurrentUserPreferences(
  currentUser: CurrentUser,
  payload: unknown
): Promise<{
  message: string;
  preferences: UserPreferenceSettings;
}> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '用户偏好格式错误',
      detail: { payload },
    });
  }

  const preferences = await updateUserPreferences(
    currentUser,
    payload as Partial<UserPreferenceSettings>,
  );

  return {
    message: '用户偏好已更新',
    preferences,
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
