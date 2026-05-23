import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError, isApiError } from '@/lib/api-error';
import { findCustomerOrderNameMatches } from '@/lib/customer-order-name-service';
import type { CurrentUser } from '@/lib/request-auth';
import { extractOrderNameFromOrderNo } from '@/lib/customer-matching';
import { buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildCompositeOrderLookupCandidates } from '@/lib/order-name-kernel';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';

export type OrderCustomerLookupMatchedBy = 'linked-order' | 'derived-order-name';

export type OrderCustomerLookupCustomer = {
  id: string;
  mark: string | null;
  normalizedMark: string | null;
  orderName: string | null;
  orderNames: string[];
  name: string | null;
  displayName: string;
  phone: string | null;
  city: string | null;
  consignee: string | null;
  companyName: string | null;
  companyAddress: string | null;
  credit: number | null;
};

export type OrderCustomerLookupSuccess = {
  success: true;
  orderNo: string;
  derivedOrderName: string | null;
  matchedBy: OrderCustomerLookupMatchedBy;
  matchedOrderNo: string | null;
  orderId: string | null;
  invoiceId: string | null;
  invNo: string | null;
  customerId: string;
  customer: OrderCustomerLookupCustomer;
};

export type OrderCustomerLookupFailure = {
  success: false;
  orderNo: string;
  code: string;
  message: string;
  status: number;
};

export type OrderCustomerLookupResult = OrderCustomerLookupSuccess | OrderCustomerLookupFailure;

export type OrderCustomerLookupBatchResult = {
  results: OrderCustomerLookupResult[];
  count: number;
  successCount: number;
  failureCount: number;
};

type LookupCustomer = {
  id: string;
  mark: string | null;
  normalizedMark?: string | null;
  orderName: string | null;
  orderNames?: Array<{ orderName: string; normalizedOrderName?: string | null; isPrimary?: boolean | null }>;
  name: string | null;
  phone: string | null;
  city: string | null;
  consignee?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  credit?: unknown;
};

type LookupOrder = {
  id: string;
  orderNo: string;
  createdAt: Date | string;
  customer: LookupCustomer | null;
  invoice?: { id: string; invNo: string; createdAt: Date | string } | null;
};

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function assertOrderMatched(orderNo: string, detail?: unknown): never {
  throw createApiError({
    code: apiErrorCodes.EXCEL_ORDER_NOT_FOUND,
    status: 404,
    message: '订单未匹配到客户',
    detail: { orderNo, ...((detail && typeof detail === 'object') ? detail : {}) },
  });
}

function assertOrderConflict(orderNo: string, detail?: unknown): never {
  throw createApiError({
    code: apiErrorCodes.EXCEL_ORDER_CONFLICT,
    status: 409,
    message: '订单匹配到多个客户',
    detail: { orderNo, ...((detail && typeof detail === 'object') ? detail : {}) },
  });
}

function sortExactOrders<T extends { createdAt: Date | string; invoice?: { createdAt: Date | string } | null }>(orders: T[]): T[] {
  return [...orders].sort((left, right) => {
    const rightInvoiceAt = right.invoice?.createdAt ? new Date(right.invoice.createdAt).getTime() : 0;
    const leftInvoiceAt = left.invoice?.createdAt ? new Date(left.invoice.createdAt).getTime() : 0;
    const invoiceDiff = rightInvoiceAt - leftInvoiceAt;
    if (invoiceDiff !== 0) return invoiceDiff;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

function orderNamesFor(customer: LookupCustomer, matchedOrderName?: string | null): string[] {
  const names = [
    matchedOrderName,
    customer.orderName,
    ...(customer.orderNames || []).map((item) => item.orderName),
  ].map(trimStr).filter(Boolean);
  return Array.from(new Set(names));
}

function serializeCustomer(customer: LookupCustomer, matchedOrderName?: string | null): OrderCustomerLookupCustomer {
  const companyName = trimStr(customer.companyName);
  const name = trimStr(customer.name);
  return {
    id: customer.id,
    mark: customer.mark,
    normalizedMark: customer.normalizedMark || null,
    orderName: trimStr(matchedOrderName) || customer.orderName,
    orderNames: orderNamesFor(customer, matchedOrderName),
    name: customer.name,
    displayName: companyName || name,
    phone: customer.phone,
    city: customer.city,
    consignee: customer.consignee || null,
    companyName: customer.companyName || null,
    companyAddress: customer.companyAddress || null,
    credit: customer.credit === null || customer.credit === undefined ? null : Number(customer.credit),
  };
}

const customerSelect = {
  id: true,
  mark: true,
  normalizedMark: true,
  orderName: true,
  name: true,
  phone: true,
  city: true,
  consignee: true,
  companyName: true,
  companyAddress: true,
  credit: true,
  orderNames: {
    select: {
      orderName: true,
      normalizedOrderName: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.CustomerSelect;

async function findExactOrders(rawOrderNo: string, visibilityWhere: ReturnType<typeof buildOrderVisibilityWhere>): Promise<LookupOrder[]> {
  const candidates = buildCompositeOrderLookupCandidates(rawOrderNo);
  let exactOrders = await db.order.findMany({
    where: {
      AND: [
        visibilityWhere,
        {
          OR: [
            ...(candidates.exactOrderNos.length > 0
              ? [{
                  orderNo: candidates.exactOrderNos.length === 1
                    ? { equals: candidates.exactOrderNos[0] }
                    : { in: candidates.exactOrderNos },
                }]
              : []),
            ...(candidates.normalizedOrderNos.length > 0
              ? [{
                  aliases: {
                    some: {
                      aliasNo: candidates.normalizedOrderNos.length === 1
                        ? candidates.normalizedOrderNos[0]
                        : { in: candidates.normalizedOrderNos },
                    },
                  },
                }]
              : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      orderNo: true,
      createdAt: true,
      customer: { select: customerSelect },
      invoice: { select: { id: true, invNo: true, createdAt: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  }) as unknown as LookupOrder[];

  if (exactOrders.length === 0) {
    const matchedOrderId = await findOrderIdByNoOrAlias(rawOrderNo, visibilityWhere);
    if (matchedOrderId) {
      exactOrders = await db.order.findMany({
        where: {
          AND: [visibilityWhere, { id: matchedOrderId }],
        },
        select: {
          id: true,
          orderNo: true,
          createdAt: true,
          customer: { select: customerSelect },
          invoice: { select: { id: true, invNo: true, createdAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
      }) as unknown as LookupOrder[];
    }
  }

  return exactOrders;
}

export async function resolveOrderCustomer(currentUser: CurrentUser, orderNo: string): Promise<OrderCustomerLookupSuccess> {
  const rawOrderNo = trimStr(orderNo);
  if (!rawOrderNo) assertOrderMatched(orderNo, { reason: 'empty-order-no' });

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const candidates = buildCompositeOrderLookupCandidates(rawOrderNo);
  const derivedOrderName = extractOrderNameFromOrderNo(rawOrderNo) || candidates.derivedOrderNames[0] || null;
  const exactOrders = await findExactOrders(rawOrderNo, visibilityWhere);

  const linkedCustomersById = new Map<string, { customer: LookupCustomer; order: LookupOrder }>();
  for (const order of sortExactOrders(exactOrders)) {
    if (order.customer?.id && !linkedCustomersById.has(order.customer.id)) {
      linkedCustomersById.set(order.customer.id, { customer: order.customer, order });
    }
  }

  if (linkedCustomersById.size === 1) {
    const { customer, order } = Array.from(linkedCustomersById.values())[0];
    const serializedCustomer = serializeCustomer(customer);
    return {
      success: true,
      orderNo: rawOrderNo,
      derivedOrderName,
      matchedBy: 'linked-order',
      matchedOrderNo: order.orderNo,
      orderId: order.id,
      invoiceId: order.invoice?.id || null,
      invNo: order.invoice?.invNo || null,
      customerId: customer.id,
      customer: serializedCustomer,
    };
  }

  if (linkedCustomersById.size > 1) {
    assertOrderConflict(rawOrderNo, { mode: 'linked-order', customerIds: Array.from(linkedCustomersById.keys()) });
  }

  if (!derivedOrderName) {
    assertOrderMatched(rawOrderNo, { reason: 'order-name-not-derived' });
  }

  const matchedCustomers = await findCustomerOrderNameMatches(ownerIds, rawOrderNo);
  if (matchedCustomers.length === 0) {
    assertOrderMatched(rawOrderNo, { derivedOrderName });
  }
  if (matchedCustomers.length > 1) {
    assertOrderConflict(rawOrderNo, {
      mode: 'derived-order-name',
      derivedOrderName,
      customerIds: matchedCustomers.map((match) => match.customer.id),
    });
  }

  const match = matchedCustomers[0];
  const serializedCustomer = serializeCustomer(match.customer, match.orderName);
  return {
    success: true,
    orderNo: rawOrderNo,
    derivedOrderName,
    matchedBy: 'derived-order-name',
    matchedOrderNo: null,
    orderId: null,
    invoiceId: null,
    invNo: null,
    customerId: match.customer.id,
    customer: serializedCustomer,
  };
}

export async function resolveOrderCustomerBatch(
  currentUser: CurrentUser,
  orderNos: string[],
): Promise<OrderCustomerLookupBatchResult> {
  const results: OrderCustomerLookupResult[] = [];

  for (const orderNo of orderNos) {
    const rawOrderNo = trimStr(orderNo);
    try {
      const result = await resolveOrderCustomer(currentUser, rawOrderNo);
      results.push(result);
    } catch (error) {
      if (isApiError(error)) {
        results.push({
          success: false,
          orderNo: rawOrderNo,
          code: error.code,
          message: error.message,
          status: error.status,
        });
      } else {
        results.push({
          success: false,
          orderNo: rawOrderNo,
          code: apiErrorCodes.INTERNAL_ERROR,
          message: '服务器错误',
          status: 500,
        });
      }
    }
  }

  const successCount = results.filter((result) => result.success).length;
  const failureCount = results.length - successCount;
  await recordAuditEvent({
    action: auditActions.CUSTOMER_ORDER_LOOKUP,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      count: results.length,
      successCount,
      failureCount,
    },
  });

  return {
    results,
    count: results.length,
    successCount,
    failureCount,
  };
}
