import { Prisma, ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { buildCompositeOrderLookupCandidates, normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import {
  confirmedAtForNewOrder,
  confirmedAtForStatusUpdate,
} from '@/lib/order-tracker-confirmation';
import { buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { getSystemSettingsWithDefaults } from '@/lib/system-settings';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const DEFAULT_ORDER_TRACKER_STATUS = 'In progress';
const DEFAULT_STATUS_OPTIONS = [DEFAULT_ORDER_TRACKER_STATUS, 'Confirmed', 'Canceled'];
const MAX_REMARK_LENGTH = 300;

type OrderTrackerPayload = {
  orderNo?: unknown;
  customerId?: unknown;
  status?: unknown;
  piStatus?: unknown;
  remark?: unknown;
  systemNote?: unknown;
};

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAuditTimestamp(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function badRequest(message: string, detail?: unknown): never {
  throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message, detail });
}

function forbidden(message = '无权限'): never {
  throw createApiError({ code: apiErrorCodes.FORBIDDEN, status: 403, message });
}

function conflict(message: string, detail?: unknown): never {
  throw createApiError({ code: apiErrorCodes.CONFLICT, status: 409, message, detail });
}

function notFound(message: string): never {
  throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message });
}

async function getStatusOptions(): Promise<string[]> {
  const settings = await getSystemSettingsWithDefaults(['ORDER_TRACKER_STATUS_OPTIONS']);
  const configured = settings.ORDER_TRACKER_STATUS_OPTIONS
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([DEFAULT_ORDER_TRACKER_STATUS, ...configured, ...DEFAULT_STATUS_OPTIONS]));
  return merged;
}

function normalizeTrackerOrderNo(value: string): string {
  return normalizeOrderIdentifier(value);
}

function buildTrackerVisibilityWhere(ownerIds: string[]): Prisma.OrderTrackerWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { customer: { ownerId: { in: ownerIds } } },
    ],
  };
}

function buildCustomerVisibilityWhere(ownerIds: string[]): Prisma.CustomerWhereInput {
  return { ownerId: { in: ownerIds } };
}

async function loadHierarchy(currentUser: CurrentUser) {
  return getHierarchyScope(currentUser);
}

function assertRemark(value: string): void {
  if (value.length > MAX_REMARK_LENGTH) {
    badRequest(`REMARK不能超过${MAX_REMARK_LENGTH}字符`, { maxLength: MAX_REMARK_LENGTH });
  }
}

function sanitizeStatus(value: unknown, options: string[], fallback = DEFAULT_ORDER_TRACKER_STATUS): string {
  const status = trimStr(value) || fallback;
  if (!options.includes(status)) {
    badRequest('ORDER状态无效', { status, options });
  }
  return status;
}

function canEditBaseFields(
  currentUser: CurrentUser,
  scope: Awaited<ReturnType<typeof loadHierarchy>>,
  target: { createdBy: string; customer?: { ownerId: string } | null },
): boolean {
  if (target.createdBy === currentUser.id) return true;
  if (scope.ownerVisibleIds.has(target.createdBy)) return true;
  if (target.customer?.ownerId && scope.ownerVisibleIds.has(target.customer.ownerId)) return true;
  return false;
}

function canEditAdminFields(
  currentUser: CurrentUser,
  scope: Awaited<ReturnType<typeof loadHierarchy>>,
  target: { createdBy: string; customer?: { ownerId: string } | null },
): boolean {
  if (currentUser.role !== UserRole.ADMIN) return false;
  if (target.createdBy === currentUser.id) return true;
  if (scope.ownerVisibleIds.has(target.createdBy)) return true;
  if (target.customer?.ownerId && scope.ownerVisibleIds.has(target.customer.ownerId)) return true;
  return false;
}

function serializeTracker(row: Record<string, unknown>, depositAmount: number, currentUser: CurrentUser, baseEditable: boolean, adminEditable: boolean) {
  const financeOrder = row.financeOrder && typeof row.financeOrder === 'object'
    ? row.financeOrder as Record<string, unknown>
    : null;
  const financeInvoice = financeOrder?.invoice && typeof financeOrder.invoice === 'object'
    ? financeOrder.invoice as Record<string, unknown>
    : null;
  return {
    ...row,
    amount: asNumber(row.amount),
    orderBalance: asNumber(row.orderBalance),
    confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt : null,
    financeOrderNo: typeof financeOrder?.orderNo === 'string' ? financeOrder.orderNo : null,
    financeInvNo: typeof financeInvoice?.invNo === 'string' ? financeInvoice.invNo : null,
    depositAmount,
    canEdit: baseEditable,
    canEditAdminFields: adminEditable,
    isMine: row.createdBy === currentUser.id,
  };
}

function orderCandidates(orderNo: string | null | undefined): Set<string> {
  const candidates = buildCompositeOrderLookupCandidates(orderNo);
  return new Set([
    ...candidates.exactOrderNos.map(normalizeOrderIdentifier),
    ...candidates.normalizedOrderNos,
    normalizeOrderIdentifier(orderNo),
  ].filter(Boolean));
}

type TrackerCustomerSnapshot = {
  id: string;
  mark: string;
  orderName: string;
  phone: string | null;
  city: string | null;
};

type VisibleFinanceOrderSnapshot = {
  id: string;
  orderNo: string;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customer: TrackerCustomerSnapshot | null;
};

function snapshotFromFinanceOrder(order: VisibleFinanceOrderSnapshot): TrackerCustomerSnapshot | null {
  if (order.customer?.id) {
    return {
      id: order.customer.id,
      mark: order.customer.mark,
      orderName: order.customer.orderName,
      phone: order.customer.phone,
      city: order.customer.city,
    };
  }
  if (!order.customerId) return null;
  return {
    id: order.customerId,
    mark: order.customerMark || '',
    orderName: order.customerName || '',
    phone: order.customerPhone || null,
    city: order.customerCity || null,
  };
}

async function findVisibleFinanceOrder(orderNo: string, ownerIds: string[]): Promise<VisibleFinanceOrderSnapshot | null> {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const financeOrderId = await findOrderIdByNoOrAlias(orderNo, orderVisibilityWhere);
  if (!financeOrderId) return null;
  return db.order.findUnique({
    where: { id: financeOrderId },
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      customer: {
        select: {
          id: true,
          mark: true,
          orderName: true,
          phone: true,
          city: true,
        },
      },
    },
  });
}

function matchesTrackerOrder(trackerCandidates: Set<string>, receipt: { orderNo?: string | null; order?: { orderNo?: string | null } | null }): boolean {
  const receiptCandidates = new Set([
    ...Array.from(orderCandidates(receipt.orderNo)),
    ...Array.from(orderCandidates(receipt.order?.orderNo)),
  ]);
  for (const candidate of receiptCandidates) {
    if (trackerCandidates.has(candidate)) return true;
  }
  return false;
}

async function calculateDepositAmounts(
  trackers: Array<{ id: string; orderNo: string }>,
  ownerIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>(trackers.map((row) => [row.id, 0]));
  if (trackers.length === 0) return result;

  const allExactOrderNos = Array.from(new Set(
    trackers.flatMap((row) => buildCompositeOrderLookupCandidates(row.orderNo).exactOrderNos),
  ));

  const receipts = await db.receipt.findMany({
    where: {
      AND: [
        {
          OR: [
            { isDeposit: true },
            { invNo: 'DEPOSIT_POOL' },
            { order: { invoice: { invNo: 'DEPOSIT_POOL' } } },
          ],
        },
        { status: { not: ReceiptStatus.SIGNING_PENDING } },
        {
          OR: [
            { createdBy: { in: ownerIds } },
            { customer: { ownerId: { in: ownerIds } } },
            { order: { createdBy: { in: ownerIds } } },
            { order: { customer: { ownerId: { in: ownerIds } } } },
          ],
        },
        allExactOrderNos.length > 0
          ? {
              OR: [
                { orderNo: { in: allExactOrderNos } },
                { order: { orderNo: { in: allExactOrderNos } } },
              ],
            }
          : {},
      ],
    },
    select: {
      orderNo: true,
      usd: true,
      status: true,
      order: {
        select: { orderNo: true },
      },
    },
  });

  for (const tracker of trackers) {
    const trackerCandidates = orderCandidates(tracker.orderNo);
    const amount = receipts.reduce((sum, receipt) => {
      if (!matchesTrackerOrder(trackerCandidates, receipt)) return sum;
      return sum + asNumber(receipt.usd);
    }, 0);
    result.set(tracker.id, amount);
  }
  return result;
}

export async function listOrderTrackers(
  currentUser: CurrentUser,
  filters: { search?: string | null; status?: string | null },
) {
  const scope = await loadHierarchy(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const statusOptions = await getStatusOptions();
  const search = trimStr(filters.search);
  const status = trimStr(filters.status);
  const where: Prisma.OrderTrackerWhereInput = {
    AND: [
      buildTrackerVisibilityWhere(ownerIds),
      status ? { status } : {},
      search
        ? {
            OR: [
              { orderNo: { contains: search } },
              { customerMark: { contains: search } },
              { customerName: { contains: search } },
              { customerPhone: { contains: search } },
              { remark: { contains: search } },
              { systemNote: { contains: search } },
            ],
          }
        : {},
    ],
  };

  const rows = await db.orderTracker.findMany({
    where,
    include: {
      creator: { select: { id: true, email: true, name: true, role: true } },
      updater: { select: { id: true, email: true, name: true, role: true } },
      customer: { select: { id: true, ownerId: true, mark: true, orderName: true, name: true, phone: true, city: true } },
      financeOrder: { select: { id: true, orderNo: true, invoice: { select: { id: true, invNo: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  const depositAmounts = await calculateDepositAmounts(
    rows.map((row) => ({ id: row.id, orderNo: row.orderNo })),
    ownerIds,
  );

  const data = rows.map((row) => {
    const baseEditable = canEditBaseFields(currentUser, scope, row);
    const adminEditable = canEditAdminFields(currentUser, scope, row);
    return serializeTracker(row as unknown as Record<string, unknown>, depositAmounts.get(row.id) || 0, currentUser, baseEditable, adminEditable);
  });

  await recordAuditEvent({
    action: auditActions.ORDER_TRACKER_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER_TRACKER,
    metadata: { count: data.length, search, status },
  });

  return {
    data,
    meta: { statusOptions, defaultStatus: DEFAULT_ORDER_TRACKER_STATUS },
    message: `Orders已加载，共 ${data.length} 条`,
  };
}

export async function listOrderTrackerCustomerOptions(currentUser: CurrentUser, filters: { search?: string | null }) {
  const scope = await loadHierarchy(currentUser);
  const ownerIds = Array.from(new Set([...scope.ownerVisibleIds, ...scope.ancestorIds]));
  const search = trimStr(filters.search);
  const rows = await db.customer.findMany({
    where: {
      AND: [
        buildCustomerVisibilityWhere(ownerIds),
        search
          ? {
              OR: [
                { mark: { contains: search } },
                { orderName: { contains: search } },
                { name: { contains: search } },
                { companyName: { contains: search } },
                { phone: { contains: search } },
              ],
            }
          : {},
      ],
    },
    select: {
      id: true,
      mark: true,
      orderName: true,
      name: true,
      companyName: true,
      phone: true,
      city: true,
      ownerId: true,
    },
    orderBy: [{ mark: 'asc' }, { orderName: 'asc' }],
    take: 100,
  });

  await recordAuditEvent({
    action: auditActions.ORDER_TRACKER_CUSTOMER_OPTIONS_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: { count: rows.length, search },
  });

  return {
    data: rows.map((row) => ({
      ...row,
      label: `${row.mark} / ${row.orderName} / ${row.companyName || row.name}`,
    })),
    message: `客户候选已加载，共 ${rows.length} 个`,
  };
}

export async function createOrderTracker(currentUser: CurrentUser, payload: OrderTrackerPayload) {
  const orderNo = trimStr(payload.orderNo);
  const customerId = trimStr(payload.customerId);
  if (!orderNo) badRequest('ORDER NO不能为空');

  const normalizedOrderNo = normalizeTrackerOrderNo(orderNo);
  if (!normalizedOrderNo) badRequest('ORDER NO无效');

  const existingTracker = await db.orderTracker.findFirst({
    where: { normalizedOrderNo },
    select: { id: true, orderNo: true },
  });
  if (existingTracker) {
    conflict('该 ORDER NO 已存在于 Orders 页面', { orderNo, existingOrderNo: existingTracker.orderNo });
  }

  const scope = await loadHierarchy(currentUser);
  const ownerIds = Array.from(new Set([...scope.ownerVisibleIds, ...scope.ancestorIds]));
  const financeOwnerIds = Array.from(scope.ownerVisibleIds);
  const visibleFinanceOrder = await findVisibleFinanceOrder(orderNo, financeOwnerIds);
  const inferredCustomer = visibleFinanceOrder ? snapshotFromFinanceOrder(visibleFinanceOrder) : null;
  const customer = customerId
    ? await db.customer.findFirst({
        where: {
          AND: [
            { id: customerId },
            buildCustomerVisibilityWhere(ownerIds),
          ],
        },
        select: {
          id: true,
          mark: true,
          orderName: true,
          name: true,
          phone: true,
          city: true,
          ownerId: true,
        },
      })
    : inferredCustomer;
  if (!customer) {
    if (customerId) notFound('客户不存在或无权限');
    badRequest('CUSTOMER不能为空，且未能从可见财务订单自动匹配客户');
  }

  const statusOptions = await getStatusOptions();
  const status = sanitizeStatus(payload.status, statusOptions);
  const confirmedAt = confirmedAtForNewOrder(status);
  const remark = trimStr(payload.remark);
  assertRemark(remark);

  const data = await db.orderTracker.create({
    data: {
      orderNo,
      normalizedOrderNo,
      tokens: serializeOrderTokens(orderNo),
      amount: 0,
      orderBalance: 0,
      financeOrderId: visibleFinanceOrder?.id || null,
      createdBy: currentUser.id,
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.orderName,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
      status,
      confirmedAt,
      piStatus: false,
      remark: remark || null,
      systemNote: null,
    },
  });

  await recordAuditEvent({
    action: auditActions.ORDER_TRACKER_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER_TRACKER,
    targetId: data.id,
    metadata: {
      orderNo,
      customerId: customer.id,
      status,
      confirmedAt: toAuditTimestamp(confirmedAt),
    },
  });

  return { data, message: 'Order已创建' };
}

export async function updateOrderTracker(currentUser: CurrentUser, idInput: unknown, payload: OrderTrackerPayload) {
  const id = trimStr(idInput);
  if (!id) badRequest('ORDER ID不能为空');

  const target = await db.orderTracker.findUnique({
    where: { id },
    include: { customer: { select: { ownerId: true } } },
  });
  if (!target) notFound('Order不存在');

  const scope = await loadHierarchy(currentUser);
  const baseEditable = canEditBaseFields(currentUser, scope, target);
  const adminEditable = canEditAdminFields(currentUser, scope, target);

  const statusOptions = await getStatusOptions();
  const data: Prisma.OrderTrackerUncheckedUpdateInput = {
    updatedBy: currentUser.id,
  };
  let statusTransitionMetadata: Record<string, unknown> | null = null;

  if (payload.status !== undefined || payload.remark !== undefined) {
    if (!baseEditable) forbidden();
    if (payload.status !== undefined) {
      const nextStatus = sanitizeStatus(payload.status, statusOptions, target.status);
      data.status = nextStatus;
      const confirmedAtUpdate = confirmedAtForStatusUpdate({
        currentStatus: target.status,
        nextStatus,
      });
      if (confirmedAtUpdate !== undefined) {
        data.confirmedAt = confirmedAtUpdate;
      }
      if (nextStatus !== target.status) {
        statusTransitionMetadata = {
          statusBefore: target.status,
          statusAfter: nextStatus,
          confirmedAtBefore: toAuditTimestamp(target.confirmedAt),
          confirmedAtAfter: confirmedAtUpdate === undefined
            ? toAuditTimestamp(target.confirmedAt)
            : toAuditTimestamp(confirmedAtUpdate),
        };
      }
    }
    if (payload.remark !== undefined) {
      const remark = trimStr(payload.remark);
      assertRemark(remark);
      data.remark = remark || null;
    }
  }

  if (payload.piStatus !== undefined || payload.systemNote !== undefined) {
    if (!adminEditable) forbidden('只有上级ADMIN可修改PI STATUS和SYSTEM NOTED');
    if (payload.piStatus !== undefined) {
      data.piStatus = Boolean(payload.piStatus);
    }
    if (payload.systemNote !== undefined) {
      data.systemNote = trimStr(payload.systemNote) || null;
    }
  }

  const dataKeys = Object.keys(data).filter((key) => key !== 'updatedBy');
  if (dataKeys.length === 0) {
    badRequest('没有可更新的内容');
  }

  const updated = await db.orderTracker.update({
    where: { id },
    data,
  });

  await recordAuditEvent({
    action: auditActions.ORDER_TRACKER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER_TRACKER,
    targetId: id,
    metadata: {
      fields: dataKeys,
      ...(statusTransitionMetadata || {}),
    },
  });

  return { data: updated, message: 'Order已更新' };
}
