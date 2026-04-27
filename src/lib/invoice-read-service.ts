import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildInvoiceVisibilityWhere, buildOrderVisibilityWhere, buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { canonicalizeOrderNo, normalizeOrderNo } from '@/lib/order-alias';
import { extractOrderNameFromOrderNo } from '@/lib/customer-matching';

function rankInvoice(invNo: string) {
  if (invNo === 'DEPOSIT_POOL') return 0;
  if (invNo === 'Un_Associated') return 1;
  return 2;
}

export async function listOrderReceiptRecords(currentUser: CurrentUser, orderId: string) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const receiptWhere = buildReceiptVisibilityWhere(ownerIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds);

  const accessibleOrder = await db.order.findFirst({
    where: {
      id: orderId,
      ...orderWhere,
    },
    select: { id: true },
  });

  if (!accessibleOrder) {
    await recordAuditEvent({
      action: auditActions.ORDER_RECEIPT_LIST_VIEW,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      targetId: orderId,
      metadata: { count: 0, accessible: false },
    });
    return { data: [], message: '订单收据记录已加载，共 0 条' };
  }

  const receipts = await db.receipt.findMany({
    where: {
      orderId,
      ...receiptWhere,
    },
    select: {
      id: true,
      receiptNo: true,
      usd: true,
      status: true,
      date: true,
      createdAt: true,
      payer: true,
      invNo: true,
      orderNo: true,
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 30,
  });

  await recordAuditEvent({
    action: auditActions.ORDER_RECEIPT_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: orderId,
    metadata: { count: receipts.length, accessible: true },
  });

  return { data: receipts, message: `订单收据记录已加载，共 ${receipts.length} 条` };
}

export async function listOrderMatchCandidates(currentUser: CurrentUser, orderNo: string) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibilityWhere = buildOrderVisibilityWhere(ownerIds);

  const matchedOrderId = await findOrderIdByNoOrAlias(orderNo, visibilityWhere);
  if (matchedOrderId) {
    const matchedOrder = await db.order.findUnique({
      where: { id: matchedOrderId },
      select: {
        id: true,
        orderNo: true,
        customerId: true,
        customerMark: true,
        customerName: true,
        customerPhone: true,
        customerCity: true,
        needsCustomerFix: true,
        createdAt: true,
      },
    });
    const data = matchedOrder ? [matchedOrder] : [];
    await recordAuditEvent({
      action: auditActions.ORDER_MATCH_CANDIDATES_VIEW,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      targetId: matchedOrderId,
      metadata: { orderNo, count: data.length, mode: 'direct' },
    });
    return { data, message: `订单匹配候选已加载，共 ${data.length} 条` };
  }

  const targetKey = deriveOrderGroupKey(orderNo);
  if (!targetKey) {
    await recordAuditEvent({
      action: auditActions.ORDER_MATCH_CANDIDATES_VIEW,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      metadata: { orderNo, count: 0, mode: 'invalid-group-key' },
    });
    return { data: [], message: '订单匹配候选已加载，共 0 条' };
  }

  const allOrders = await db.order.findMany({
    where: visibilityWhere,
    select: {
      id: true,
      orderNo: true,
      orderBalance: true,
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      needsCustomerFix: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const matched = allOrders.filter((row) => deriveOrderGroupKey(row.orderNo) === targetKey);

  await recordAuditEvent({
    action: auditActions.ORDER_MATCH_CANDIDATES_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    metadata: { orderNo, count: matched.length, mode: 'group-fallback' },
  });

  return { data: matched, message: `订单匹配候选已加载，共 ${matched.length} 条` };
}

export async function lookupInvoiceOrderContext(currentUser: CurrentUser, orderNo: string) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const rawOrderNo = String(orderNo || '').trim();
  const normalizedOrderNo = normalizeOrderNo(rawOrderNo);
  const canonicalOrderNo = canonicalizeOrderNo(rawOrderNo);
  const derivedOrderName = extractOrderNameFromOrderNo(rawOrderNo);

  if (!rawOrderNo) {
    await recordAuditEvent({
      action: auditActions.ORDER_MATCH_CANDIDATES_VIEW,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      metadata: { orderNo, count: 0, mode: 'context-empty' },
    });
    return {
      data: {
        exactMatches: [],
        inferredCustomer: null,
        derivedOrderName: null,
      },
      message: '订单上下文已加载，共 0 条',
    };
  }

  const exactMatches = await db.order.findMany({
    where: {
      AND: [
        visibilityWhere,
        {
          OR: [
            { orderNo: { equals: rawOrderNo } },
            { orderNo: { equals: canonicalOrderNo } },
            { aliases: { some: { aliasNo: normalizedOrderNo } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      orderNo: true,
      orderBalance: true,
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      needsCustomerFix: true,
      createdAt: true,
      invoice: {
        select: {
          id: true,
          invNo: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  exactMatches.sort((left, right) => {
    const invoiceDiff = new Date(right.invoice.createdAt).getTime() - new Date(left.invoice.createdAt).getTime();
    if (invoiceDiff !== 0) return invoiceDiff;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  let inferredCustomer: null | {
    id: string;
    mark: string;
    orderName: string;
    name: string;
    phone: string | null;
    city: string | null;
  } = null;

  if (derivedOrderName) {
    const matchedCustomers = await db.customer.findMany({
      where: {
        ownerId: { in: ownerIds },
        orderName: { equals: derivedOrderName },
      },
      select: {
        id: true,
        mark: true,
        orderName: true,
        name: true,
        phone: true,
        city: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    if (matchedCustomers.length === 1) {
      inferredCustomer = matchedCustomers[0];
    }
  }

  await recordAuditEvent({
    action: auditActions.ORDER_MATCH_CANDIDATES_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    metadata: {
      orderNo,
      count: exactMatches.length,
      mode: 'context',
      inferredCustomer: Boolean(inferredCustomer),
      derivedOrderName,
    },
  });

  return {
    data: {
      exactMatches,
      inferredCustomer,
      derivedOrderName,
    },
    message: `订单上下文已加载，共 ${exactMatches.length} 条`,
  };
}

export async function listInvoiceRecords(currentUser: CurrentUser, search: string) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);

  const invoices = await db.invoice.findMany({
    where: buildInvoiceVisibilityWhere(ownerIds),
    include: {
      orders: {
        where: buildOrderVisibilityWhere(ownerIds),
        include: {
          receipts: {
            where: {
              orderId: { not: null },
              ...buildReceiptVisibilityWhere(ownerIds),
            },
            select: { usd: true, status: true },
          },
        },
      },
      creator: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = invoices.map((invoice) => {
    const invAmount = invoice.orders.reduce((sum, order) => sum + Number(order.amount), 0);
    const receivedAmount = invoice.orders.reduce((sum, order) => (
      sum + order.receipts.reduce((receiptSum, receipt) => receiptSum + Number(receipt.usd), 0)
    ), 0);
    const invBalance = invAmount - receivedAmount;

    return {
      ...invoice,
      invAmount,
      invBalance,
      orders: invoice.orders.map((order) => {
        const orderReceived = order.receipts.reduce((sum, receipt) => sum + Number(receipt.usd), 0);
        return {
          ...order,
          orderBalance: Number(order.amount) - orderReceived,
          isSystemOrder: false,
        };
      }),
    };
  });

  const filtered = filterRowsBySearch(result, search);
  filtered.sort((a, b) => {
    const rankDiff = rankInvoice(a.invNo) - rankInvoice(b.invNo);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  await recordAuditEvent({
    action: auditActions.INVOICE_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    metadata: { count: filtered.length, search: String(search || '') },
  });

  return { data: filtered, message: `账单列表已加载，共 ${filtered.length} 个账单` };
}
