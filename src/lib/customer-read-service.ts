import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { customerAccessWhere, splitPhoneCandidates } from '@/lib/customer-scope';
import { buildCompositeOrderLookupCandidates, normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import { filterRowsBySearch } from '@/lib/text-search';
import {
  normalizeCustomerHistoryPagination,
  paginateCustomerHistoryRows,
  sortCustomerHistoryOrders,
} from '@/lib/customer-order-history-pagination';
import { computeOrderBalanceFromReceipts } from '@/lib/order-balance';
import { canSalesEditExtendedCustomerFields } from '@/lib/customer-service';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

function toSalesView<T extends Record<string, unknown>>(row: T, showExtended: boolean): T {
  if (showExtended) return row;
  return {
    ...row,
    companyName: null,
    companyAddress: null,
    credit: null,
  };
}

function annotatePhoneConflicts<T extends Record<string, unknown>>(rows: T[]): Array<T & { phoneConflict: boolean; phoneConflictMessage: string }> {
  const tokenBuckets = new Map<string, Set<string>>();

  for (const row of rows) {
    const id = String(row.id || '');
    const ownerId = String(row.ownerId || '');
    if (!id || !ownerId) continue;
    for (const token of splitPhoneCandidates(String(row.phone || ''))) {
      const bucketKey = `${ownerId}:${token}`;
      if (!tokenBuckets.has(bucketKey)) tokenBuckets.set(bucketKey, new Set());
      tokenBuckets.get(bucketKey)!.add(id);
    }
  }

  const conflictedIds = new Set<string>();
  for (const ids of tokenBuckets.values()) {
    if (ids.size < 2) continue;
    for (const id of ids) conflictedIds.add(id);
  }

  return rows.map((row) => ({
    ...row,
    phoneConflict: conflictedIds.has(String(row.id || '')),
    phoneConflictMessage: conflictedIds.has(String(row.id || '')) ? '手机号冲突，请修改' : '',
  }));
}

export async function listCustomerOwnerOptions(currentUser: CurrentUser) {
  ensureManager(currentUser);

  const options = currentUser.role === UserRole.ADMIN
    ? await db.user.findMany({
        where: {
          OR: [
            { id: currentUser.id },
            { role: UserRole.SALES },
          ],
        },
        select: { id: true, email: true, name: true, role: true, level: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      })
    : [
        {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role,
          level: currentUser.level,
        },
      ];

  await recordAuditEvent({
    action: auditActions.CUSTOMER_OWNER_OPTIONS_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      count: options.length,
      currentRole: currentUser.role,
    },
  });

  return { data: options, message: `客户归属候选已加载，共 ${options.length} 个账号` };
}

export async function listCustomers(
  currentUser: CurrentUser,
  filters: { mark?: string | null; search?: string | null },
) {
  ensureManager(currentUser);

  const where: Record<string, unknown> = {
    ...customerAccessWhere(currentUser),
  };

  const mark = trimStr(filters.mark);
  const search = trimStr(filters.search);

  const rows = await db.customer.findMany({
    where,
    include: {
      orderNames: {
        select: {
          orderName: true,
          normalizedOrderName: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      consignees: {
        select: {
          id: true,
          consignee: true,
          isPrimary: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          level: true,
        },
      },
    },
    orderBy: [{ mark: 'asc' }, { createdAt: 'desc' }],
  });

  const showExtended = currentUser.role === UserRole.ADMIN || await canSalesEditExtendedCustomerFields();
  const conflictAnnotatedRows = annotatePhoneConflicts(rows as Array<Record<string, unknown>>);
  const normalizedMark = mark ? normalizeOrderIdentifier(mark) : '';
  const markedRows = normalizedMark
    ? conflictAnnotatedRows.filter((row) => normalizeOrderIdentifier(trimStr(row.mark)) === normalizedMark)
    : conflictAnnotatedRows;
  const data = currentUser.role === UserRole.ADMIN
    ? filterRowsBySearch(markedRows, search)
    : filterRowsBySearch(markedRows.map((row) => toSalesView(row as Record<string, unknown>, showExtended)), search);

  await recordAuditEvent({
    action: auditActions.CUSTOMER_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      count: data.length,
      mark,
      search,
      showExtended,
    },
  });

  return { data, message: `客户列表已加载，共 ${data.length} 个客户` };
}

function toDateText(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function orderMatchesOrderName(orderNo: string | null | undefined, normalizedOrderName: string): boolean {
  if (!normalizedOrderName) return false;
  if (normalizeOrderIdentifier(orderNo) === normalizedOrderName) return true;
  return buildCompositeOrderLookupCandidates(orderNo).orderNameCandidates
    .some((candidate) => candidate.normalizedOrderName === normalizedOrderName);
}

export async function getCustomerOrderNameHistory(
  currentUser: CurrentUser,
  input: {
    customerId: string;
    orderName: string;
    orderPage?: unknown;
    orderPageSize?: unknown;
    receiptPage?: unknown;
    receiptPageSize?: unknown;
    defaultOrderPageSize?: number;
    defaultReceiptPageSize?: number;
  },
) {
  ensureManager(currentUser);

  const customerId = trimStr(input.customerId);
  const orderName = trimStr(input.orderName);
  const normalizedOrderName = normalizeOrderIdentifier(orderName);
  if (!customerId || !normalizedOrderName) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '缺少客户或ORDER_NAME' });
  }

  const customer = await db.customer.findFirst({
    where: {
      ...customerAccessWhere(currentUser),
      id: customerId,
    },
    include: {
      orderNames: {
        select: {
          orderName: true,
          normalizedOrderName: true,
          isPrimary: true,
        },
      },
    },
  });
  if (!customer) {
    throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '客户不存在或无权限' });
  }

  const isKnownOrderName = normalizeOrderIdentifier(customer.orderName) === normalizedOrderName
    || customer.orderNames.some((row) => row.normalizedOrderName === normalizedOrderName);
  if (!isKnownOrderName) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: 'ORDER_NAME不属于该客户' });
  }

  const orderPaginationRequest = normalizeCustomerHistoryPagination(
    { page: input.orderPage, pageSize: input.orderPageSize },
    { defaultPageSize: input.defaultOrderPageSize },
  );
  const receiptPaginationRequest = normalizeCustomerHistoryPagination(
    { page: input.receiptPage, pageSize: input.receiptPageSize },
    { defaultPageSize: input.defaultReceiptPageSize },
  );

  const rows = await db.order.findMany({
    where: { customerId },
    include: {
      invoice: {
        select: { invNo: true, shipDate: true, releaseDate: true },
      },
      receipts: {
        select: { usd: true, status: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  const sortedOrders = sortCustomerHistoryOrders(rows
    .filter((row) => orderMatchesOrderName(row.orderNo, normalizedOrderName))
    .map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      invNo: row.invoice?.invNo || null,
      amount: Number(row.amount),
      outstanding: Array.isArray(row.receipts)
        ? computeOrderBalanceFromReceipts({ amount: row.amount, receipts: row.receipts })
        : Number(row.orderBalance),
      shipDate: row.invoice?.shipDate || null,
      releaseDate: row.invoice?.releaseDate || null,
      createdAt: row.createdAt,
    })));
  const { items: orders, pagination: orderPagination } = paginateCustomerHistoryRows(
    sortedOrders,
    orderPaginationRequest.page,
    orderPaginationRequest.pageSize,
  );

  const receiptWhere = { customerId };
  const totalReceipts = await db.receipt.count({ where: receiptWhere });
  const receiptTotalPages = Math.max(1, Math.ceil(totalReceipts / receiptPaginationRequest.pageSize));
  const receiptPage = Math.min(receiptPaginationRequest.page, receiptTotalPages);
  const receipts = await db.receipt.findMany({
    where: receiptWhere,
    select: {
      id: true,
      receiptNo: true,
      orderNo: true,
      invNo: true,
      usd: true,
      status: true,
      date: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (receiptPage - 1) * receiptPaginationRequest.pageSize,
    take: receiptPaginationRequest.pageSize,
  });
  const receiptPagination = {
    page: receiptPage,
    pageSize: receiptPaginationRequest.pageSize,
    totalItems: totalReceipts,
    totalPages: receiptTotalPages,
  };

  return {
    data: {
      orders: orders.map(({ shipDate: _shipDate, releaseDate: _releaseDate, createdAt: _createdAt, ...row }) => row),
      orderPagination,
      receipts: receipts.map((row) => ({
        id: row.id,
        receiptNo: row.receiptNo,
        orderNo: row.orderNo,
        invNo: row.invNo,
        usd: Number(row.usd),
        status: row.status,
        date: toDateText(row.date),
        createdAt: row.createdAt.toISOString(),
      })),
      receiptPagination,
    },
    message: `客户ORDER_NAME历史已加载，共 ${orderPagination.totalItems} 条订单`,
  };
}
