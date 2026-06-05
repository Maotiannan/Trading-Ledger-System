import { ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildInvoiceVisibilityWhere, buildOrderVisibilityWhere, buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { extractOrderNameFromOrderNo } from '@/lib/customer-matching';
import { findCustomerOrderNameMatches } from '@/lib/customer-order-name-service';
import { buildCompositeOrderLookupCandidates } from '@/lib/order-name-kernel';
import { getCustomerPayerBase } from '@/lib/customer-display';
import { addMoney, moneyToNumber, subtractMoney, type MoneyInput } from '@/lib/money';

function rankInvoice(invNo: string) {
  if (invNo === 'DEPOSIT_POOL') return 0;
  if (invNo === 'Un_Associated') return 1;
  return 2;
}

function computeLiveOrderBalance(row: {
  amount?: unknown;
  orderBalance?: unknown;
  receipts?: Array<{ usd: unknown; status?: unknown }>;
}): number {
  const amount = moneyToNumber(row.amount as MoneyInput);
  if (!Number.isFinite(amount) || !Array.isArray(row.receipts)) {
    return moneyToNumber((row.orderBalance || 0) as MoneyInput);
  }

  const received = addMoney(
    row.receipts
      .filter((receipt) => receipt.status !== ReceiptStatus.SIGNING_PENDING)
      .map((receipt) => receipt.usd || 0)
  );

  return moneyToNumber(subtractMoney(amount, received));
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
      amount: true,
      orderBalance: true,
      receipts: {
        where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
        select: { usd: true, status: true },
      },
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
  const candidates = buildCompositeOrderLookupCandidates(rawOrderNo);
  const derivedOrderName = extractOrderNameFromOrderNo(rawOrderNo) || candidates.derivedOrderNames[0] || null;

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

  let exactMatches = await db.order.findMany({
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
      amount: true,
      orderBalance: true,
      receipts: {
        where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
        select: { usd: true, status: true },
      },
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      needsCustomerFix: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          orderName: true,
          companyName: true,
          mark: true,
          name: true,
          phone: true,
          city: true,
        },
      },
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

  if (exactMatches.length === 0) {
    const matchedOrderId = await findOrderIdByNoOrAlias(rawOrderNo, visibilityWhere);
    if (matchedOrderId) {
      exactMatches = await db.order.findMany({
        where: {
          AND: [
            visibilityWhere,
            { id: matchedOrderId },
          ],
        },
        select: {
          id: true,
          orderNo: true,
          amount: true,
          orderBalance: true,
          receipts: {
            where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
            select: { usd: true, status: true },
          },
          customerId: true,
          customerMark: true,
          customerName: true,
          customerPhone: true,
          customerCity: true,
          needsCustomerFix: true,
          createdAt: true,
          customer: {
            select: {
              id: true,
              orderName: true,
              companyName: true,
              mark: true,
              name: true,
              phone: true,
              city: true,
            },
          },
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
    }
  }

  exactMatches.sort((left, right) => {
    const invoiceDiff = new Date(right.invoice.createdAt).getTime() - new Date(left.invoice.createdAt).getTime();
    if (invoiceDiff !== 0) return invoiceDiff;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  const exactContextMatches = exactMatches.map((row) => ({
    ...row,
    orderBalance: computeLiveOrderBalance(row),
    customerPhone: row.customerPhone || row.customer?.phone || null,
    customerPayer: getCustomerPayerBase(row.customer || {}),
  }));

  let inferredCustomer: null | {
    id: string;
    mark: string;
    orderName: string;
    name: string;
    companyName: string | null;
    phone: string | null;
    city: string | null;
  } = null;

  if (rawOrderNo) {
    const matchedCustomers = await findCustomerOrderNameMatches(ownerIds, rawOrderNo);

    if (matchedCustomers.length === 1) {
      inferredCustomer = {
        id: matchedCustomers[0].customer.id,
        mark: matchedCustomers[0].customer.mark,
        orderName: matchedCustomers[0].orderName,
        name: matchedCustomers[0].customer.name,
        companyName: matchedCustomers[0].customer.companyName,
        phone: matchedCustomers[0].customer.phone,
        city: matchedCustomers[0].customer.city,
      };
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
        exactMatches: exactContextMatches,
        inferredCustomer,
        derivedOrderName,
      },
      message: `订单上下文已加载，共 ${exactContextMatches.length} 条`,
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
              status: { not: ReceiptStatus.SIGNING_PENDING },
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
    const invAmount = moneyToNumber(addMoney(invoice.orders.map((order) => order.amount)));
    const receivedAmount = addMoney(invoice.orders.flatMap((order) => order.receipts.map((receipt) => receipt.usd)));
    const invBalance = moneyToNumber(subtractMoney(invAmount, receivedAmount));

    return {
      ...invoice,
      invAmount,
      invBalance,
      orders: invoice.orders.map((order) => {
        const orderReceived = addMoney(order.receipts.map((receipt) => receipt.usd));
        return {
          ...order,
          orderBalance: moneyToNumber(subtractMoney(order.amount, orderReceived)),
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
