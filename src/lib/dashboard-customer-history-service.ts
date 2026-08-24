import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import {
  buildDashboardOutstandingSnapshot,
  dashboardOutstandingInvoiceSelect,
} from '@/lib/dashboard-customer-outstanding';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { readCustomerHistory, type CustomerHistoryReadInput } from '@/lib/customer-history-service';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import type { CurrentUser } from '@/lib/request-auth';
import {
  buildCustomerVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

export type DashboardCustomerSearchItem = {
  customerId: string;
  mark: string;
  name: string;
  orderNames: string[];
};

export type DashboardCustomerSearchResult = {
  query: string;
  items: DashboardCustomerSearchItem[];
};

function uniqueOrderNames(primary: string, aliases: Array<{ orderName: string }>): string[] {
  return Array.from(new Set([primary, ...aliases.map((row) => row.orderName)]
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

export async function searchDashboardCustomers(
  currentUser: CurrentUser,
  rawQuery: string,
): Promise<DashboardCustomerSearchResult> {
  const query = String(rawQuery || '').trim();
  if (!query) {
    throw createApiError({ code: apiErrorCodes.BAD_REQUEST, status: 400, message: '请输入搜索内容' });
  }

  const ownerIds = await getOwnerVisibleIds(currentUser);
  const customerVisibilityWhere = buildCustomerVisibilityWhere(ownerIds);
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const normalizedQuery = normalizeOrderIdentifier(query);

  const matchedOrderId = await findOrderIdByNoOrAlias(query, orderVisibilityWhere);
  const matchedOrder = matchedOrderId
    ? await db.order.findUnique({ where: { id: matchedOrderId }, select: { customerId: true } })
    : null;

  const matchWhere: Prisma.CustomerWhereInput = {
    OR: [
      { normalizedMark: normalizedQuery },
      { orderNames: { some: { normalizedOrderName: normalizedQuery } } },
      { orderName: { equals: query } },
      { name: { contains: query } },
      ...(matchedOrder?.customerId ? [{ id: matchedOrder.customerId }] : []),
    ],
  };

  const rows = await db.customer.findMany({
    where: { AND: [customerVisibilityWhere, matchWhere] },
    select: {
      id: true,
      mark: true,
      normalizedMark: true,
      orderName: true,
      name: true,
      orderNames: {
        select: { orderName: true, normalizedOrderName: true, isPrimary: true },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  const matchedCustomerId = matchedOrder?.customerId || null;
  const sortedRows = rows.slice().sort((left, right) => {
    const rank = (row: typeof left) => {
      if (matchedCustomerId && row.id === matchedCustomerId) return 0;
      if (row.orderNames.some((item) => item.normalizedOrderName === normalizedQuery)) return 1;
      if (row.normalizedMark === normalizedQuery) return 2;
      return 3;
    };
    return rank(left) - rank(right)
      || left.mark.localeCompare(right.mark, 'en', { sensitivity: 'base' })
      || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
      || left.id.localeCompare(right.id);
  });

  return {
    query,
    items: sortedRows.map((row) => ({
      customerId: row.id,
      mark: row.mark,
      name: row.name,
      orderNames: uniqueOrderNames(row.orderName, row.orderNames),
    })),
  };
}

export async function getDashboardCustomerHistory(
  currentUser: CurrentUser,
  input: Omit<CustomerHistoryReadInput, 'orderName' | 'customerWhere' | 'orderWhere' | 'receiptWhere'>,
) {
  const ownerIds = await getOwnerVisibleIds(currentUser);
  const customerWhere = buildCustomerVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const history = await readCustomerHistory({
    ...input,
    orderName: null,
    customerWhere,
    orderWhere,
    receiptWhere,
  });
  const customerOrderWhere: Prisma.OrderWhereInput = {
    AND: [orderWhere, { customerId: history.data.customer.id }],
  };
  const invoices = await db.invoice.findMany({
    where: {
      invNo: { notIn: ['Un_Associated', 'DEPOSIT_POOL'] },
      orders: { some: customerOrderWhere },
    },
    select: dashboardOutstandingInvoiceSelect(customerOrderWhere),
  });
  const snapshot = buildDashboardOutstandingSnapshot(invoices);

  return {
    data: {
      ...history.data,
      outstanding: snapshot.customerOutstanding.find(
        (row) => row.customerId === history.data.customer.id,
      ) ?? null,
    },
  };
}
