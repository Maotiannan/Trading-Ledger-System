import { ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { buildInvoiceVisibilityWhere, buildOrderVisibilityWhere, buildReceiptVisibilityWhere } from '@/lib/resource-visibility';
import { filterRowsBySearch } from '@/lib/text-search';
import { canonicalizeOrderNo, normalizeOrderNo } from '@/lib/order-alias';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { extractOrderNameFromOrderNo } from '@/lib/customer-matching';
import { findCustomerOrderNameMatches } from '@/lib/customer-order-name-service';
import { buildCompositeOrderLookupCandidates } from '@/lib/order-name-kernel';
import { getCustomerPayerBase } from '@/lib/customer-display';
import { addMoney, moneyToNumber } from '@/lib/money';
import { computeOrderBalanceFromReceipts, type OrderBalanceReceiptInput, type OrderPaymentAllocationInput } from '@/lib/order-balance';
import { receiptBalanceSelect, paymentAllocationsSelect } from '@/lib/prepayments/balance-select';
import { readInvoiceSourceMetadata, sourceDateFields } from '@/lib/integrations/mucont-invoice-metadata';
import { invoiceRevision } from '@/lib/integrations/mucont-invoice-service';
import { loadOrderPaymentRecords } from '@/lib/prepayments/order-payment-records';
import { loadDepositPool } from '@/lib/prepayments/pool-read-service';
import { customerBusinessSelect, customerOrderName } from '@/lib/customer-business-label';

function rankInvoice(invNo: string) {
  if (invNo === 'DEPOSIT_POOL') return 0;
  if (invNo === 'Un_Associated') return 1;
  return 2;
}

function computeReadOrderBalance(row: {
  amount?: unknown;
  orderBalance?: unknown;
  receipts?: OrderBalanceReceiptInput[];
  paymentAllocations?: OrderPaymentAllocationInput[];
}): number {
  if (!Array.isArray(row.receipts)) {
    return moneyToNumber((row.orderBalance || 0) as never);
  }

  return computeOrderBalanceFromReceipts({
    amount: (row.amount || 0) as never,
    receipts: row.receipts,
    paymentAllocations: row.paymentAllocations,
  });
}

export async function listOrderReceiptRecords(
  currentUser: CurrentUser,
  orderId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const orderWhere = buildOrderVisibilityWhere(ownerIds, true);

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
    return {
      data: [],
      pagination: { page: 1, pageSize: options.pageSize || 30, totalItems: 0, totalPages: 1 },
      message: '订单收据记录已加载，共 0 条',
    };
  }

  const pageSize = Math.min(50, Math.max(5, Number(options.pageSize) || 30));
  const page = Math.max(1, Number(options.page) || 1);
  const records = await loadOrderPaymentRecords(orderId, ownerIds);
  const totalItems = records.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const receipts = records.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  await recordAuditEvent({
    action: auditActions.ORDER_RECEIPT_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: orderId,
    metadata: { count: receipts.length, totalItems, page: currentPage, pageSize, accessible: true },
  });

  return {
    data: receipts,
    pagination: { page: currentPage, pageSize, totalItems, totalPages },
    message: `订单收据记录已加载，共 ${totalItems} 条`,
  };
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
        customer: { select: customerBusinessSelect },
        customerName: true,
        customerPhone: true,
        customerCity: true,
        needsCustomerFix: true,
        createdAt: true,
      },
    });
    const data = matchedOrder ? [{ ...matchedOrder, customerMark: matchedOrder.customer?.mark ?? matchedOrder.customerMark,
      customerName: matchedOrder.customer ? customerOrderName(matchedOrder.customer, matchedOrder.customerName) : matchedOrder.customerName }] : [];
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
      paymentAllocations: paymentAllocationsSelect,
      receipts: {
        where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
        select: receiptBalanceSelect,
      },
      customerId: true,
      customerMark: true,
      customer: { select: customerBusinessSelect },
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

  return { data: matched.map(({ paymentAllocations: _allocations, receipts, ...row }) => ({
    ...row, customerMark: row.customer?.mark ?? row.customerMark,
    customerName: row.customer ? customerOrderName(row.customer, row.customerName) : row.customerName,
    orderBalance: computeReadOrderBalance({ ...row, receipts, paymentAllocations: _allocations }),
    receipts: receipts?.map(({ funding: _funding, ...receipt }) => receipt),
  })), message: `订单匹配候选已加载，共 ${matched.length} 条` };
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
      paymentAllocations: paymentAllocationsSelect,
      receipts: {
        where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
        select: receiptBalanceSelect,
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
          ...customerBusinessSelect,
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

  const completeMatches = exactMatches.filter(row =>
    normalizeOrderNo(canonicalizeOrderNo(row.orderNo)) === normalizeOrderNo(canonicalizeOrderNo(rawOrderNo)));
  if (completeMatches.length) exactMatches = completeMatches;

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
          paymentAllocations: paymentAllocationsSelect,
          receipts: {
            where: { status: { not: ReceiptStatus.SIGNING_PENDING } },
            select: receiptBalanceSelect,
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
              ...customerBusinessSelect,
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

  const exactContextMatches = exactMatches.map(({ paymentAllocations, receipts, ...row }) => ({
    ...row, receipts: receipts?.map(({ funding: _funding, ...receipt }) => receipt),
    customerMark: row.customer?.mark ?? row.customerMark,
    customerName: row.customer ? customerOrderName(row.customer, row.customerName) : row.customerName,
    orderBalance: computeReadOrderBalance({ ...row, receipts, paymentAllocations }),
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
      mucontSource: { select: { generationId: true, publicationSequence: true, appliedAt: true } },
      _count: { select: { orders: true } },
      orders: {
        // Retained groups participate in full-invoice authorization and revision.
        where: buildOrderVisibilityWhere(ownerIds, true),
        include: {
          customer: { select: customerBusinessSelect },
          paymentAllocations: paymentAllocationsSelect,
          receipts: {
            where: {
              orderId: { not: null },
              status: { not: ReceiptStatus.SIGNING_PENDING },
              ...buildReceiptVisibilityWhere(ownerIds),
            },
            select: receiptBalanceSelect,
          },
        },
      },
      creator: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const metadata = await readInvoiceSourceMetadata(invoices.filter((row) => row.mucontSource).map((row) => row.id));
  // An order/customer may make an invoice visible outside its managing branch.
  // Authorize by invoice before looking up titles, including when two invoices share one title.
  const creditIdByInvoice = new Map<string, string>();
  if (currentUser.role === 'ADMIN') {
    for (const invoice of invoices) {
      if (!invoice.mucontSource || invoice._count.orders !== invoice.orders.length ||
          !scope.ownerVisibleIds.has(invoice.managedById ?? invoice.createdBy)) continue;
      const source = metadata.get(invoice.id);
      const id = source?.metadata?.creditInsurance?.creditRecordId;
      if (source?.availability === 'available' && id) creditIdByInvoice.set(invoice.id, id);
    }
  }
  const headings = creditIdByInvoice.size ? await db.customer.findMany({
    where: { id: { in: [...new Set(creditIdByInvoice.values())] } },
    select: { id: true, orderName: true },
  }) : [];
  const orderNameByCreditId = new Map(headings.map(row => [row.id, row.orderName.trim()]));
  const depositPool = await loadDepositPool(currentUser, ownerIds);
  const result = invoices.map((invoice) => {
    const { mucontSource, _count, ...publicInvoice } = invoice;
    const wholeInvoice = _count?.orders === invoice.orders.length;
    const sourceMetadata = metadata.get(invoice.id);
    const creditId = creditIdByInvoice.get(invoice.id);
    const creditInsurance = creditId && orderNameByCreditId.get(creditId);
    const orders = invoice.orders.filter(order => !order.canceledAt).map(({ paymentAllocations, receipts, ...order }) => ({
      ...order, receipts: receipts?.map(({ funding: _funding, ...receipt }) => receipt),
      customerMark: order.customer?.mark ?? order.customerMark,
      customerName: order.customer ? customerOrderName(order.customer, order.customerName) : order.customerName,
      orderBalance: computeOrderBalanceFromReceipts({ ...order, receipts, paymentAllocations }),
      isSystemOrder: false,
    }));
    const invAmount = moneyToNumber(addMoney(orders.map((order) => order.amount)));
    const invBalance = moneyToNumber(addMoney(orders.map((order) => order.orderBalance)));

    return {
      ...publicInvoice,
      ...(sourceMetadata ? sourceDateFields(sourceMetadata.metadata) : {}),
      ...(mucontSource ? { source: {
        provider: 'MUCONT', generationId: mucontSource.generationId, publicationSequence: mucontSource.publicationSequence,
        appliedAt: mucontSource.appliedAt, revision: wholeInvoice ? invoiceRevision(invoice) : null,
        canResync: currentUser.role === 'ADMIN' && wholeInvoice,
        canDownloadBillOfLading: wholeInvoice && sourceMetadata?.availability === 'available' && Boolean(sourceMetadata.metadata?.billOfLading),
        metadataStale: sourceMetadata?.stale ?? true, metadataAvailability: sourceMetadata?.availability ?? 'unavailable',
        metadataReadAt: sourceMetadata?.readAt ?? null,
        ...(creditInsurance ? { creditInsurance } : {}),
      } } : {}),
      invAmount,
      invBalance,
      orders,
      ...(invoice.invNo === 'DEPOSIT_POOL' ? { depositPool } : {}),
    };
  });

  // A retained credit can outlive its original pool order. This is a read-only
  // container, not a new financial invoice or another source of income.
  const withPool = depositPool.rows.length && !result.some(row => row.invNo === 'DEPOSIT_POOL')
    ? [...result, { id: 'deposit-pool-view', invNo: 'DEPOSIT_POOL', orders: [], invAmount: 0, invBalance: 0,
      depositPool, createdAt: new Date(0) }] : result;
  const filtered = filterRowsBySearch(withPool, search);
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
