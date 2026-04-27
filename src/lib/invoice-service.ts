import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { updateOrderBalance } from '@/lib/matching';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { resolveCustomer } from '@/lib/customer-matching';
import { deriveOrderGroupKey } from '@/lib/order-group';
import { saveInvoiceWithOrders } from '@/lib/invoice-write';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { canonicalizeOrderNo, normalizeOrderNo, splitCompositeOrderNo } from '@/lib/order-alias';
import { consolidateGroupedOrders, findOrderIdByNoOrAlias, syncOrderAliases } from '@/lib/order-alias-db';
import { customerAccessWhere } from '@/lib/customer-scope';
import type { CurrentUser } from '@/lib/request-auth';
import {
  buildInvoiceVisibilityWhere as buildInvoiceVisibilityWhereShared,
  buildOrderVisibilityWhere as buildOrderVisibilityWhereShared,
  buildReceiptVisibilityWhere as buildReceiptVisibilityWhereShared,
} from '@/lib/resource-visibility';
import { runInTransaction } from '@/lib/transaction';

export function parseDateInput(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export type InvoiceImportInputRow = {
  rowNo: number;
  invNo: string;
  shipDateRaw: string;
  releaseDateRaw: string;
  orderNo: string;
  amountRaw: string;
  customerMark: string;
  customerName: string;
  customerId: string;
};

export type InvoiceImportIssueRow = {
  rowNo: number;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orderNo: string;
  amount: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  reason: string;
};

export type InvoiceImportRowResult = {
  rowNo: number;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orderNo: string;
  amount: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  status: 'SUCCESS' | 'FAILED';
  reason: string;
};

export type InvoiceImportProcessResult = {
  success: boolean;
  status: number;
  message: string;
  details: string[];
  issueRows: InvoiceImportIssueRow[];
  importedOrderNos: string[];
  rowResults: InvoiceImportRowResult[];
};

export type RematchConflictGroup = {
  groupId: string;
  groupType: 'exact' | 'customer-group';
  groupKey: string;
  orders: Array<{
    id: string;
    invoiceId: string;
    invNo: string;
    orderNo: string;
    amount: number;
    orderBalance: number;
    receiptCount: number;
    createdAt: Date;
  }>;
};

function badRequest(message: string, detail?: unknown) {
  return createApiError({ code: 'BAD_REQUEST', status: 400, message, detail });
}

function notFound(message: string, detail?: unknown) {
  return createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message, detail });
}

function conflict(message: string, detail?: unknown) {
  return createApiError({ code: 'CONFLICT', status: 400, message, detail });
}

function forbidden(message: string, detail?: unknown) {
  return createApiError({ code: 'FORBIDDEN', status: 403, message, detail });
}

export const buildOrderVisibilityWhere = buildOrderVisibilityWhereShared;
export const buildReceiptVisibilityWhere = buildReceiptVisibilityWhereShared;
const buildInvoiceVisibilityWhere = buildInvoiceVisibilityWhereShared;

function toInvoiceIssueRow(row: InvoiceImportInputRow, reason: string): InvoiceImportIssueRow {
  return {
    rowNo: row.rowNo,
    invNo: row.invNo,
    shipDate: row.shipDateRaw,
    releaseDate: row.releaseDateRaw,
    orderNo: row.orderNo,
    amount: row.amountRaw,
    customerMark: row.customerMark,
    customerName: row.customerName,
    customerId: row.customerId,
    reason,
  };
}

function toInvoiceRowResult(
  row: InvoiceImportInputRow,
  status: 'SUCCESS' | 'FAILED',
  reason: string
): InvoiceImportRowResult {
  return {
    rowNo: row.rowNo,
    invNo: row.invNo,
    shipDate: row.shipDateRaw,
    releaseDate: row.releaseDateRaw,
    orderNo: row.orderNo,
    amount: row.amountRaw,
    customerMark: row.customerMark,
    customerName: row.customerName,
    customerId: row.customerId,
    status,
    reason,
  };
}

export async function processInvoiceImportRows(
  rows: InvoiceImportInputRow[],
  currentUser: Pick<CurrentUser, 'id' | 'role'>
): Promise<InvoiceImportProcessResult> {
  const scope = await getHierarchyScope(currentUser as CurrentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const customerVisibilityWhere = customerAccessWhere(currentUser as CurrentUser);

  const visibleOrders = await db.order.findMany({
    where: orderVisibilityWhere,
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customerMark: true,
      customerName: true,
    },
  });
  const orderById = new Map(visibleOrders.map((row) => [row.id, row]));
  const visibleCustomers = await db.customer.findMany({
    where: customerVisibilityWhere,
    select: { id: true, mark: true, orderName: true },
  });
  const normalizeOrderNameForMatch = (value: string | null | undefined): string =>
    String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const customerByOrderNameMap = new Map<string, Array<{ id: string; mark: string; orderName: string }>>();
  for (const customer of visibleCustomers) {
    const key = normalizeOrderNameForMatch(customer.orderName);
    if (!key) continue;
    if (!customerByOrderNameMap.has(key)) customerByOrderNameMap.set(key, []);
    customerByOrderNameMap.get(key)!.push(customer);
  }
  const inferCache = new Map<string, { matched: boolean; customerMark?: string; customerName?: string; customerId?: string; reason?: string }>();
  const importedOrderNos = new Set<string>();
  const batchOrderSet = new Set<string>();

  const grouped = new Map<string, {
    shipDate: Date | null | undefined;
    releaseDate: Date | null | undefined;
    rows: Array<{ orderNo: string; amount: number; customerMark: string; customerName?: string; customerId?: string }>;
    sourceRows: InvoiceImportInputRow[];
  }>();
  const issueRows: InvoiceImportIssueRow[] = [];
  const rowResults: InvoiceImportRowResult[] = [];
  const successMessages: string[] = [];

  const extractOrderNameFromOrderNo = (singleOrderNo: string): string | null => {
    const normalized = String(singleOrderNo || '').trim();
    const lastDashIndex = normalized.lastIndexOf('-');
    if (lastDashIndex <= 0 || lastDashIndex >= normalized.length - 1) return null;
    const left = normalized.slice(0, lastDashIndex).trim().replace(/\s+/g, ' ');
    return left || null;
  };

  const inferCustomerBySingleOrderNo = async (singleOrderNo: string) => {
    const cacheKey = singleOrderNo.toLowerCase();
    if (!inferCache.has(cacheKey)) {
      const inferResult: { matched: boolean; customerMark?: string; customerName?: string; customerId?: string; reason?: string } = { matched: false };
      const matchedOrderId = await findOrderIdByNoOrAlias(singleOrderNo, orderVisibilityWhere);
      if (matchedOrderId) {
        const matchedOrder = orderById.get(matchedOrderId);
        if (matchedOrder?.customerMark) {
          inferResult.matched = true;
          inferResult.customerMark = matchedOrder.customerMark;
          inferResult.customerName = matchedOrder.customerName || '';
          inferResult.customerId = matchedOrder.customerId || '';
        }
      }

      if (!inferResult.matched) {
        const orderName = extractOrderNameFromOrderNo(singleOrderNo);
        if (!orderName) {
          inferResult.reason = '应该含‘-’的ORDER格式';
        } else {
          const key = normalizeOrderNameForMatch(orderName);
          const matchedCustomers = customerByOrderNameMap.get(key) || [];
          if (matchedCustomers.length === 1) {
            const selected = matchedCustomers[0];
            inferResult.matched = true;
            inferResult.customerMark = selected.mark;
            inferResult.customerName = selected.orderName || '';
            inferResult.customerId = selected.id;
          } else if (matchedCustomers.length > 1) {
            inferResult.reason = '同一ORDER_NAME命中多客户';
          } else {
            inferResult.reason = '客户库无匹配';
          }
        }
      }
      inferCache.set(cacheKey, inferResult);
    }
    return inferCache.get(cacheKey)!;
  };

  for (const input of rows) {
    const invNo = String(input.invNo || '').trim();
    const shipDateRaw = String(input.shipDateRaw || '').trim();
    const releaseDateRaw = String(input.releaseDateRaw || '').trim();
    const rawOrderNo = String(input.orderNo || '').trim();
    const amountRaw = String(input.amountRaw || '').trim();
    let customerMark = String(input.customerMark || '').trim();
    let customerName = String(input.customerName || '').trim();
    let customerId = String(input.customerId || '').trim();

    if (!invNo && !rawOrderNo && !amountRaw && !customerMark && !shipDateRaw && !releaseDateRaw) continue;
    const orderNo = canonicalizeOrderNo(rawOrderNo);

    const rowErrors: string[] = [];
    const amount = Number(amountRaw);
    const shipDate = shipDateRaw ? parseDateInput(shipDateRaw) : undefined;
    const releaseDate = releaseDateRaw ? parseDateInput(releaseDateRaw) : undefined;
    if (!invNo) rowErrors.push('INV_NO 不能为空');
    if (!orderNo) rowErrors.push('ORDER_NO 不能为空');
    if (!Number.isFinite(amount) || amount <= 0) rowErrors.push('AMOUNT 必须大于0');
    if (shipDateRaw && shipDate === undefined) rowErrors.push('SHIP_DATE 格式错误，应为 YYYY-MM-DD');
    if (releaseDateRaw && releaseDate === undefined) rowErrors.push('RELEASE_DATE 格式错误，应为 YYYY-MM-DD');

    if (orderNo && rowErrors.length === 0) {
      const duplicateKey = normalizeOrderNo(orderNo);
      if (batchOrderSet.has(duplicateKey)) {
        rowErrors.push(`ORDER_NO=${orderNo} 此条已存在（本次上传内重复）`);
      } else {
        const existingOrderId = await findOrderIdByNoOrAlias(orderNo, orderVisibilityWhere);
        if (existingOrderId) {
          rowErrors.push(`ORDER_NO=${orderNo} 此条已存在`);
        } else {
          batchOrderSet.add(duplicateKey);
        }
      }
    }

    if (!customerMark && orderNo) {
      const parts = splitCompositeOrderNo(orderNo);
      if (parts.length > 1) {
        const inferredMarks: Array<{ customerMark: string; customerName: string; customerId: string }> = [];
        for (const part of parts) {
          const inferred = await inferCustomerBySingleOrderNo(part);
          if (!inferred.matched || !inferred.customerMark) {
            rowErrors.push(`CUSTOMER_MARK 为空且无法自动匹配：子单号 ${part} ${inferred.reason || '未知原因'}`);
            break;
          }
          inferredMarks.push({
            customerMark: inferred.customerMark,
            customerName: inferred.customerName || '',
            customerId: inferred.customerId || '',
          });
        }
        if (rowErrors.length === 0) {
          const uniqMarkMap = new Map<string, { customerMark: string; customerName: string; customerId: string }>();
          for (const inferred of inferredMarks) {
            const markKey = inferred.customerMark.toLowerCase();
            if (!uniqMarkMap.has(markKey)) uniqMarkMap.set(markKey, inferred);
          }
          if (uniqMarkMap.size !== 1) {
            rowErrors.push('这条非同客户单号');
          } else {
            const selected = Array.from(uniqMarkMap.values())[0];
            customerMark = selected.customerMark;
            if (!customerName && selected.customerName) customerName = selected.customerName;
            if (!customerId && selected.customerId) customerId = selected.customerId;
          }
        }
      } else {
        const inferred = await inferCustomerBySingleOrderNo(orderNo);
        if (inferred.matched && inferred.customerMark) {
          customerMark = inferred.customerMark;
          if (!customerName && inferred.customerName) customerName = inferred.customerName;
          if (!customerId && inferred.customerId) customerId = inferred.customerId;
        } else {
          rowErrors.push(`CUSTOMER_MARK 为空且无法自动匹配：${inferred.reason || '未知原因'}`);
        }
      }
    }

    if (rowErrors.length > 0) {
      const failedRow = {
        ...input,
        invNo,
        shipDateRaw,
        releaseDateRaw,
        orderNo,
        amountRaw,
        customerMark,
        customerName,
        customerId,
      };
      const reason = rowErrors.join('；');
      issueRows.push(toInvoiceIssueRow(failedRow, reason));
      rowResults.push(toInvoiceRowResult(failedRow, 'FAILED', reason));
      continue;
    }

    if (!grouped.has(invNo)) {
      grouped.set(invNo, {
        shipDate,
        releaseDate,
        rows: [],
        sourceRows: [],
      });
    }
    const bucket = grouped.get(invNo)!;
    if (shipDate !== undefined) bucket.shipDate = shipDate;
    if (releaseDate !== undefined) bucket.releaseDate = releaseDate;
    bucket.rows.push({
      orderNo,
      amount,
      customerMark,
      customerName: customerName || undefined,
      customerId: customerId || undefined,
    });
    bucket.sourceRows.push({
      ...input,
      invNo,
      shipDateRaw,
      releaseDateRaw,
      orderNo,
      amountRaw,
      customerMark,
      customerName,
      customerId,
    });
  }

  if (grouped.size === 0) {
    return {
      success: false,
      status: 400,
      message: '没有可导入的数据行',
      details: issueRows.map((row) => `第${row.rowNo}行 ${row.reason}`),
      issueRows,
      importedOrderNos: [],
      rowResults: rowResults.sort((a, b) => a.rowNo - b.rowNo),
    };
  }

  let successCount = 0;
  for (const [invNo, group] of grouped.entries()) {
    const saved = await saveInvoiceWithOrders({
      invNo,
      orders: group.rows,
      createdBy: currentUser.id,
      shipDate: group.shipDate,
      releaseDate: group.releaseDate,
      ownerIds,
    });
    if (!saved.ok) {
      for (const row of group.sourceRows) {
        const reason = `INV_NO=${invNo} 导入失败：${saved.error}`;
        issueRows.push(toInvoiceIssueRow(row, reason));
        rowResults.push(toInvoiceRowResult(row, 'FAILED', reason));
      }
      continue;
    }
    successCount++;
    for (const row of group.rows) importedOrderNos.add(row.orderNo);
    for (const row of group.sourceRows) {
      rowResults.push(toInvoiceRowResult(row, 'SUCCESS', ''));
    }
    successMessages.push(`${invNo}: ${saved.message}`);
  }

  if (successCount === 0) {
    return {
      success: false,
      status: 400,
      message: '导入失败：没有成功导入的账单',
      details: issueRows.map((row) => `第${row.rowNo}行 ${row.reason}`),
      issueRows,
      importedOrderNos: [],
      rowResults: rowResults.sort((a, b) => a.rowNo - b.rowNo),
    };
  }

  await recordAuditEvent({
    action: auditActions.INVOICE_IMPORT,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    metadata: {
      successCount,
      failedRows: issueRows.length,
      importedOrderNos: Array.from(importedOrderNos),
    },
  });

  return {
    success: true,
    status: 200,
    message: `导入完成：成功 ${successCount} 个账单，失败 ${issueRows.length} 行`,
    details: issueRows.length > 0
      ? issueRows.map((row) => `第${row.rowNo}行 ${row.reason}`)
      : successMessages,
    issueRows,
    importedOrderNos: Array.from(importedOrderNos),
    rowResults: rowResults.sort((a, b) => a.rowNo - b.rowNo),
  };
}

export async function createInvoiceRecord(currentUser: CurrentUser, input: {
  invNo: string;
  orders: Array<{ orderNo: string; amount: number; customerMark: string; customerName?: string | null; customerId?: string | null }>;
  shipDate?: Date | null;
  releaseDate?: Date | null;
}) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const saved = await saveInvoiceWithOrders({
    invNo: String(input.invNo || ''),
    orders: Array.isArray(input.orders) ? input.orders : [],
    createdBy: currentUser.id,
    shipDate: input.shipDate,
    releaseDate: input.releaseDate,
    ownerIds,
  });
  if (!saved.ok) {
    throw createApiError({
      code: 'BAD_REQUEST',
      status: saved.status,
      message: saved.error,
      detail: { invNo: input.invNo },
    });
  }
  await recordAuditEvent({
    action: auditActions.INVOICE_CREATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    targetId: saved.data?.id,
    metadata: {
      invNo: input.invNo,
      orderCount: input.orders.length,
    },
  });
  return { data: saved.data, message: saved.message };
}

async function rematchAllOrders(ownerIds: string[]) {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptVisibilityWhere = buildReceiptVisibilityWhere(ownerIds);

  const allOrders = await db.order.findMany({
    where: orderVisibilityWhere,
    include: {
      invoice: true,
      receipts: true,
    },
  });

  let mergedCount = 0;
  let receiptMatchedCount = 0;
  let customerSyncedCount = 0;
  let deletedInvoiceCount = 0;
  let deletedZeroOrdersCount = 0;

  const orderGroups = new Map<string, typeof allOrders>();
  for (const order of allOrders) {
    const normalizedOrderNo = normalizeOrderNo(order.orderNo);
    const key = normalizedOrderNo;
    if (!orderGroups.has(key)) orderGroups.set(key, []);
    orderGroups.get(key)!.push(order);
  }

  for (const orders of orderGroups.values()) {
    if (orders.length <= 1) continue;
    const targetOrder = orders.find((row) => row.invoice.invNo !== 'Un_Associated') || orders[0];
    const sourceOrders = orders.filter((row) => row.id !== targetOrder.id);
    if (sourceOrders.length === 0) continue;
    await runInTransaction(async (tx) => {
      for (const sourceOrder of sourceOrders) {
        await tx.receipt.updateMany({
          where: { orderId: sourceOrder.id },
          data: { orderId: targetOrder.id },
        });
        await tx.order.delete({
          where: { id: sourceOrder.id },
        });
        mergedCount++;
      }
      await updateOrderBalance(targetOrder.id, tx);
    });
  }

  const freshOrders = await db.order.findMany({
    where: orderVisibilityWhere,
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      needsCustomerFix: true,
    },
  });
  const groupMap = new Map<string, typeof freshOrders>();
  for (const row of freshOrders) {
    const key = deriveOrderGroupKey(row.orderNo);
    if (!key) continue;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(row);
  }
  for (const grouped of groupMap.values()) {
    if (grouped.length <= 1) continue;
    const resolved = grouped.find((row) => row.customerId && !row.needsCustomerFix);
    if (!resolved) continue;
    const targetOrderIds = grouped.map((row) => row.id);
    const receiptRows = await db.receipt.findMany({
      where: {
        ...receiptVisibilityWhere,
        orderNo: { not: null },
      },
      select: { id: true, orderNo: true },
    });
    const targetReceiptIds = receiptRows
      .filter((row) => deriveOrderGroupKey(row.orderNo) === deriveOrderGroupKey(resolved.orderNo))
      .map((row) => row.id);
    await runInTransaction(async (tx) => {
      const touched = await tx.order.updateMany({
        where: { id: { in: targetOrderIds } },
        data: {
          customerId: resolved.customerId,
          customerMark: resolved.customerMark,
          customerName: resolved.customerName,
          customerPhone: resolved.customerPhone,
          customerCity: resolved.customerCity,
          needsCustomerFix: false,
        },
      });
      customerSyncedCount += touched.count;

      if (targetReceiptIds.length > 0) {
        const syncedReceipts = await tx.receipt.updateMany({
          where: { id: { in: targetReceiptIds } },
          data: {
            customerId: resolved.customerId,
            customerMark: resolved.customerMark,
            customerName: resolved.customerName,
            customerPhone: resolved.customerPhone,
            customerCity: resolved.customerCity,
            needsCustomerFix: false,
          },
        });
        customerSyncedCount += syncedReceipts.count;
      }
    });
  }

  for (const row of freshOrders) {
    if (row.customerId || !row.needsCustomerFix) continue;
    const resolved = await resolveCustomer({
      customerMark: typeof row.customerMark === 'string' ? row.customerMark : '',
      customerName: typeof row.customerName === 'string' ? row.customerName : null,
      customerId: null,
      customerOrderNo: row.orderNo,
      ownerIds,
    });
    if (!resolved.customerId || resolved.needsCustomerFix) continue;
    await runInTransaction(async (tx) => {
      await tx.order.update({
        where: { id: row.id },
        data: {
          customerId: resolved.customerId,
          customerMark: resolved.customerMark,
          customerName: resolved.customerName,
          customerPhone: resolved.customerPhone,
          customerCity: resolved.customerCity,
          needsCustomerFix: false,
        },
      });
    });
    customerSyncedCount++;
  }

  const allReceipts = await db.receipt.findMany({
    where: {
      ...receiptVisibilityWhere,
      orderId: null,
      orderNo: { not: null },
    },
  });
  for (const receipt of allReceipts) {
    if (!receipt.orderNo) continue;
    const sameOrderId = await findOrderIdByNoOrAlias(receipt.orderNo, orderVisibilityWhere);
    if (sameOrderId) {
      await runInTransaction(async (tx) => {
        await tx.receipt.update({
          where: { id: receipt.id },
          data: { orderId: sameOrderId },
        });
        await updateOrderBalance(sameOrderId, tx);
      });
      receiptMatchedCount++;
      continue;
    }

    const key = deriveOrderGroupKey(receipt.orderNo);
    if (!key) continue;
    const groupOrders = await db.order.findMany({
      where: orderVisibilityWhere,
      orderBy: { createdAt: 'asc' },
    });
    const matchedByGroup = groupOrders.find((row) => deriveOrderGroupKey(row.orderNo) === key);
    if (matchedByGroup) {
      await runInTransaction(async (tx) => {
        await tx.receipt.update({
          where: { id: receipt.id },
          data: { orderId: matchedByGroup.id },
        });
        await updateOrderBalance(matchedByGroup.id, tx);
      });
      receiptMatchedCount++;
    }
  }

  const touchedInvoiceIds = Array.from(new Set(allOrders.map((row) => row.invoiceId)));
  const invoices = touchedInvoiceIds.length > 0
    ? await db.invoice.findMany({
        where: { id: { in: touchedInvoiceIds } },
        select: { id: true, invNo: true, _count: { select: { orders: true } } },
      })
    : [];
  for (const invoice of invoices) {
    if (invoice._count.orders === 0) {
      await runInTransaction((tx) => tx.invoice.delete({ where: { id: invoice.id } }));
      deletedInvoiceCount++;
    }
  }

  const orderIds = await db.order.findMany({ where: orderVisibilityWhere, select: { id: true } });
  for (const row of orderIds) {
    await runInTransaction((tx) => updateOrderBalance(row.id, tx));
  }

  const zeroOrders = await db.order.findMany({
    where: {
      AND: [
        orderVisibilityWhere,
        {
          amount: 0,
          orderBalance: 0,
        },
      ],
    },
    include: {
      _count: { select: { receipts: true } },
    },
  });
  for (const order of zeroOrders) {
    if (order._count.receipts > 0) continue;
    await runInTransaction((tx) => tx.order.delete({ where: { id: order.id } }));
    deletedZeroOrdersCount++;
  }

  const consolidated = await consolidateGroupedOrders({ orderWhere: orderVisibilityWhere });

  return {
    mergedCount,
    receiptMatchedCount,
    customerSyncedCount,
    deletedInvoiceCount,
    deletedZeroOrdersCount,
    groupedMergedCount: consolidated.mergedOrders,
    groupedCreatedCount: consolidated.createdGroups,
  };
}

async function listRematchConflictGroupsByScope(ownerIds: string[]): Promise<RematchConflictGroup[]> {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const receiptVisibilityWhere = buildReceiptVisibilityWhere(ownerIds);
  const orders = await db.order.findMany({
    where: orderVisibilityWhere,
    include: {
      invoice: { select: { id: true, invNo: true } },
      _count: { select: { receipts: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const normalized = (value: string) => value.trim().toLowerCase();
  const exactMap = new Map<string, typeof orders>();
  const groupMap = new Map<string, typeof orders>();
  const unmatchedReceipts = await db.receipt.findMany({
    where: {
      ...receiptVisibilityWhere,
      orderId: null,
      orderNo: { not: null },
    },
    select: { orderNo: true },
  });
  const unmatchedGroupCount = new Map<string, number>();
  for (const receipt of unmatchedReceipts) {
    const key = deriveOrderGroupKey(receipt.orderNo);
    if (!key) continue;
    unmatchedGroupCount.set(key, (unmatchedGroupCount.get(key) || 0) + 1);
  }

  for (const order of orders) {
    const exactKey = normalized(order.orderNo);
    if (!exactMap.has(exactKey)) exactMap.set(exactKey, []);
    exactMap.get(exactKey)!.push(order);

    const groupKey = deriveOrderGroupKey(order.orderNo);
    if (!groupKey) continue;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(order);
  }

  const groups: RematchConflictGroup[] = [];
  for (const [key, rows] of exactMap) {
    if (rows.length <= 1) continue;
    groups.push({
      groupId: `exact:${key}`,
      groupType: 'exact',
      groupKey: key,
      orders: rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoice.id,
        invNo: row.invoice.invNo,
        orderNo: row.orderNo,
        amount: Number(row.amount),
        orderBalance: Number(row.orderBalance),
        receiptCount: row._count.receipts,
        createdAt: row.createdAt,
      })),
    });
  }
  for (const [key, rows] of groupMap) {
    if (rows.length <= 1) continue;
    const uniqueOrderNos = new Set(rows.map((row) => normalized(row.orderNo)));
    if (uniqueOrderNos.size <= 1) continue;
    if (!unmatchedGroupCount.get(key)) continue;
    groups.push({
      groupId: `group:${key}`,
      groupType: 'customer-group',
      groupKey: key,
      orders: rows.map((row) => ({
        id: row.id,
        invoiceId: row.invoice.id,
        invNo: row.invoice.invNo,
        orderNo: row.orderNo,
        amount: Number(row.amount),
        orderBalance: Number(row.orderBalance),
        receiptCount: row._count.receipts,
        createdAt: row.createdAt,
      })),
    });
  }

  groups.sort((a, b) => a.groupId.localeCompare(b.groupId));
  return groups;
}

async function applyRematchConflicts(
  resolutions: Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>,
  ownerIds: string[]
) {
  const orderVisibilityWhere = buildOrderVisibilityWhere(ownerIds);
  let mergedCount = 0;
  for (const resolution of resolutions) {
    const uniqueOrderIds = Array.from(new Set(resolution.orderIds.filter(Boolean)));
    if (uniqueOrderIds.length <= 1) continue;
    if (!uniqueOrderIds.includes(resolution.keepOrderId)) continue;

    const rows = await db.order.findMany({
      where: {
        AND: [
          { id: { in: uniqueOrderIds } },
          orderVisibilityWhere,
        ],
      },
      include: { receipts: { select: { id: true } } },
    });
    if (rows.length <= 1) continue;

    const keepRow = rows.find((row) => row.id === resolution.keepOrderId);
    if (!keepRow) continue;

    const sourceRows = rows.filter((row) => row.id !== keepRow.id);
    if (sourceRows.length === 0) continue;

    let incrementAmount = 0;
    await runInTransaction(async (tx) => {
      for (const source of sourceRows) {
        await tx.receipt.updateMany({
          where: { orderId: source.id },
          data: { orderId: keepRow.id },
        });
        if (resolution.mode === 'merge') {
          incrementAmount += Number(source.amount);
        }
        await tx.order.delete({ where: { id: source.id } });
        mergedCount++;
      }

      if (incrementAmount !== 0) {
        await tx.order.update({
          where: { id: keepRow.id },
          data: { amount: { increment: incrementAmount } },
        });
      }
      await updateOrderBalance(keepRow.id, tx);
    });
  }

  return { mergedCount };
}

export async function previewInvoiceRematch(currentUser: CurrentUser) {
  const scope = await getHierarchyScope(currentUser);
  return listRematchConflictGroupsByScope(Array.from(scope.ownerVisibleIds));
}

export async function applyInvoiceRematch(
  currentUser: CurrentUser,
  resolutions: Array<{ groupId: string; keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>
) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const applied = await applyRematchConflicts(resolutions, ownerIds);
  const result = await rematchAllOrders(ownerIds);
  const message = `冲突处理完成（当前可见范围）：人工合并 ${applied.mergedCount}，自动合并 ${result.mergedCount}，组合合并 ${result.groupedMergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}`;
  await recordAuditEvent({
    action: auditActions.INVOICE_REMATCH_APPLY,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    metadata: {
      manualMerged: applied.mergedCount,
      ...result,
    },
  });
  return { message };
}

export async function rematchInvoices(currentUser: CurrentUser) {
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const result = await rematchAllOrders(ownerIds);
  const message = `重新匹配完成（当前可见范围）：合并重复订单 ${result.mergedCount}，组合合并 ${result.groupedMergedCount}，补匹配收据 ${result.receiptMatchedCount}，同步客户 ${result.customerSyncedCount}，清理空账单 ${result.deletedInvoiceCount}，清理空订单 ${result.deletedZeroOrdersCount}`;
  await recordAuditEvent({
    action: auditActions.INVOICE_REMATCH,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    metadata: result,
  });
  return { message };
}

export async function assignInvoiceToBranchAdmin(currentUser: CurrentUser, payload: {
  invoiceId: string;
  targetAdminId: string;
}) {
  if (currentUser.role !== UserRole.ADMIN) {
    throw forbidden('只有管理员可以分配账单归属');
  }

  const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId.trim() : '';
  const targetAdminId = typeof payload.targetAdminId === 'string' ? payload.targetAdminId.trim() : '';
  if (!invoiceId) {
    throw badRequest('账单ID不能为空');
  }
  if (!targetAdminId) {
    throw badRequest('目标管理员不能为空');
  }

  const scope = await getHierarchyScope(currentUser);
  const descendantIds = Array.from(scope.descendantIds);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  if (!descendantIds.includes(targetAdminId)) {
    throw forbidden('目标管理员不属于当前分支', { targetAdminId });
  }
  const targetAdmin = await db.user.findFirst({
    where: {
      id: targetAdminId,
      role: UserRole.ADMIN,
    },
    select: { id: true, email: true, level: true },
  });
  if (!targetAdmin) {
    throw forbidden('目标管理员不属于当前分支', { targetAdminId });
  }

  const invoice = await db.invoice.findFirst({
    where: {
      id: invoiceId,
      ...buildInvoiceVisibilityWhere(ownerIds),
    },
    select: {
      id: true,
      invNo: true,
      createdBy: true,
      orders: { select: { id: true } },
    },
  });
  if (!invoice) {
    throw notFound('账单不存在或无权限修改', { invoiceId });
  }

  if (invoice.createdBy !== targetAdminId) {
    await runInTransaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { createdBy: targetAdminId },
      });
      await tx.order.updateMany({
        where: { invoiceId },
        data: { createdBy: targetAdminId },
      });
    });
  }

  await recordAuditEvent({
    action: auditActions.INVOICE_ASSIGN_BRANCH_ADMIN,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    targetId: invoiceId,
    metadata: {
      invNo: invoice.invNo,
      previousOwnerId: invoice.createdBy,
      nextOwnerId: targetAdminId,
      orderCount: invoice.orders.length,
      targetAdminEmail: targetAdmin.email,
    },
  });

  return {
    data: {
      invoiceId,
      targetAdminId,
    },
    message: invoice.createdBy === targetAdminId ? '账单归属未变化' : '账单归属已分配',
  };
}

export async function updateInvoiceDates(currentUser: CurrentUser, payload: {
  invoiceId: string;
  shipDate?: unknown;
  releaseDate?: unknown;
}) {
  const targetInvoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId.trim() : '';
  if (!targetInvoiceId) {
    throw badRequest('账单ID不能为空');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibleInvoice = await db.invoice.findFirst({
    where: {
      id: targetInvoiceId,
      ...buildInvoiceVisibilityWhere(ownerIds),
    },
    select: { id: true, shipDate: true, releaseDate: true },
  });
  if (!visibleInvoice) {
    throw notFound('账单不存在或无权限修改', { invoiceId: targetInvoiceId });
  }

  const shipDateRaw = Object.prototype.hasOwnProperty.call(payload, 'shipDate') ? payload.shipDate : undefined;
  const releaseDateRaw = Object.prototype.hasOwnProperty.call(payload, 'releaseDate') ? payload.releaseDate : undefined;
  const parsedShipDate = parseDateInput(shipDateRaw);
  const parsedReleaseDate = parseDateInput(releaseDateRaw);
  if (shipDateRaw !== undefined && shipDateRaw !== null && shipDateRaw !== '' && parsedShipDate === undefined) {
    throw badRequest('SHIP_DATE 格式错误，应为 YYYY-MM-DD');
  }
  if (releaseDateRaw !== undefined && releaseDateRaw !== null && releaseDateRaw !== '' && parsedReleaseDate === undefined) {
    throw badRequest('RELEASE_DATE 格式错误，应为 YYYY-MM-DD');
  }

  const updateData: { shipDate?: Date | null; releaseDate?: Date | null } = {};
  if (shipDateRaw !== undefined) updateData.shipDate = shipDateRaw === '' || shipDateRaw === null ? null : (parsedShipDate as Date);
  if (releaseDateRaw !== undefined) updateData.releaseDate = releaseDateRaw === '' || releaseDateRaw === null ? null : (parsedReleaseDate as Date);
  if (Object.keys(updateData).length === 0) {
    throw badRequest('缺少可更新字段');
  }

  const updated = await runInTransaction(async (tx) => tx.invoice.update({
    where: { id: targetInvoiceId },
    data: updateData,
  }));
  await recordAuditEvent({
    action: auditActions.INVOICE_UPDATE_DATES,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    targetId: targetInvoiceId,
    metadata: {
      before: {
        shipDate: visibleInvoice.shipDate?.toISOString() || null,
        releaseDate: visibleInvoice.releaseDate?.toISOString() || null,
      },
      after: {
        shipDate: updated.shipDate?.toISOString() || null,
        releaseDate: updated.releaseDate?.toISOString() || null,
      },
    },
  });
  return { data: updated, message: '账单日期已更新' };
}

export async function updateInvoiceOrder(currentUser: CurrentUser, payload: {
  orderId: string;
  orderNo?: string;
  amount?: number;
  customerMark?: string;
  customerName?: string;
  customerId?: string;
  customerPhone?: string;
  customerCity?: string;
}) {
  const orderId = payload.orderId;
  if (!orderId) {
    throw badRequest('订单ID不能为空');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const order = await db.order.findFirst({
    where: {
      id: orderId,
      ...buildOrderVisibilityWhere(ownerIds),
    },
  });
  if (!order) {
    throw notFound('订单不存在', { orderId });
  }

  const incomingOrderNoRaw = typeof payload.orderNo === 'string' ? payload.orderNo.trim() : order.orderNo;
  const incomingOrderNo = canonicalizeOrderNo(incomingOrderNoRaw);
  const incomingAmount = payload.amount !== undefined ? Number(payload.amount) : Number(order.amount);
  if (!incomingOrderNo) {
    throw badRequest('客户单号不能为空');
  }
  if (!Number.isFinite(incomingAmount) || incomingAmount < 0) {
    throw badRequest('金额必须为大于等于0的数字');
  }

  const incomingCustomerMark = typeof payload.customerMark === 'string' ? payload.customerMark.trim() : (order.customerMark || '');
  const incomingCustomerName = typeof payload.customerName === 'string' ? payload.customerName.trim() : (order.customerName || '');
  const incomingCustomerId = typeof payload.customerId === 'string' ? payload.customerId.trim() : (order.customerId || '');
  const incomingCustomerPhone = typeof payload.customerPhone === 'string' ? payload.customerPhone.trim() : (order.customerPhone || '');
  const incomingCustomerCity = typeof payload.customerCity === 'string' ? payload.customerCity.trim() : (order.customerCity || '');

  let customerData = {
    customerId: order.customerId,
    customerMark: order.customerMark,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    needsCustomerFix: order.needsCustomerFix,
  };

  if (incomingCustomerMark) {
    const resolved = await resolveCustomer({
      customerMark: incomingCustomerMark,
      customerName: incomingCustomerName || null,
      customerId: incomingCustomerId || null,
      customerOrderNo: incomingOrderNo,
      ownerIds,
    });
    customerData = {
      customerId: resolved.customerId,
      customerMark: resolved.customerMark,
      customerName: resolved.customerName,
      customerPhone: resolved.customerPhone ?? (incomingCustomerPhone || null),
      customerCity: resolved.customerCity ?? (incomingCustomerCity || null),
      needsCustomerFix: resolved.needsCustomerFix,
    };
  } else {
    customerData = {
      customerId: null,
      customerMark: null,
      customerName: incomingCustomerName || null,
      customerPhone: incomingCustomerPhone || null,
      customerCity: incomingCustomerCity || null,
      needsCustomerFix: true,
    };
  }

  const updated = await runInTransaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        orderNo: incomingOrderNo,
        tokens: serializeOrderTokens(incomingOrderNo),
        amount: incomingAmount,
        customerId: customerData.customerId,
        customerMark: customerData.customerMark,
        customerName: customerData.customerName,
        customerPhone: customerData.customerPhone,
        customerCity: customerData.customerCity,
        needsCustomerFix: customerData.needsCustomerFix,
      },
    });
    await syncOrderAliases(tx, orderId, incomingOrderNo);
    await tx.receipt.updateMany({
      where: { orderId },
      data: {
        orderNo: incomingOrderNo,
        customerId: customerData.customerId,
        customerMark: customerData.customerMark,
        customerName: customerData.customerName,
        customerPhone: customerData.customerPhone,
        customerCity: customerData.customerCity,
        needsCustomerFix: customerData.needsCustomerFix,
      },
    });
    return updatedOrder;
  });

  await updateOrderBalance(orderId);
  if (normalizeOrderNo(incomingOrderNo) !== normalizeOrderNo(order.orderNo)) {
    await rematchAllOrders(ownerIds);
  }

  await recordAuditEvent({
    action: auditActions.ORDER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: orderId,
    metadata: {
      before: {
        orderNo: order.orderNo,
        amount: Number(order.amount),
      },
      after: {
        orderNo: incomingOrderNo,
        amount: incomingAmount,
      },
    },
  });
  return { data: updated, message: '订单已更新' };
}

export async function addInvoiceOrder(currentUser: CurrentUser, payload: {
  invoiceId: string;
  orderNo: string;
  amount: number;
  customerMark: string;
  customerName?: string;
  customerId?: string;
}) {
  const customerMark = typeof payload.customerMark === 'string' ? payload.customerMark.trim() : '';
  const customerName = typeof payload.customerName === 'string' ? payload.customerName.trim() : '';
  const customerId = typeof payload.customerId === 'string' ? payload.customerId.trim() : '';
  const incomingOrderNo = canonicalizeOrderNo(typeof payload.orderNo === 'string' ? payload.orderNo : '');
  const incomingAmount = Number(payload.amount);
  if (!payload.invoiceId || !incomingOrderNo || !Number.isFinite(incomingAmount) || incomingAmount <= 0 || !customerMark) {
    throw badRequest('缺少必要参数');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibleInvoice = await db.invoice.findFirst({
    where: {
      id: payload.invoiceId,
      ...buildInvoiceVisibilityWhere(ownerIds),
    },
    select: { id: true },
  });
  if (!visibleInvoice) {
    throw notFound('账单不存在或无权限修改', { invoiceId: payload.invoiceId });
  }

  const customerResolution = await resolveCustomer({
    customerMark,
    customerName: customerName || null,
    customerId: customerId || null,
    customerOrderNo: incomingOrderNo,
    ownerIds,
  });

  const existingOrderId = await findOrderIdByNoOrAlias(incomingOrderNo, buildOrderVisibilityWhere(ownerIds));
  const existingOrder = existingOrderId
    ? await db.order.findUnique({
        where: { id: existingOrderId },
        include: { invoice: true },
      })
    : null;

  if (existingOrder) {
    const updated = await runInTransaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: existingOrder.id },
        data: {
          ...(normalizeOrderNo(existingOrder.orderNo) !== normalizeOrderNo(incomingOrderNo)
            ? {
                orderNo: incomingOrderNo,
                tokens: serializeOrderTokens(incomingOrderNo),
              }
            : {}),
          amount: { increment: incomingAmount },
          orderBalance: { increment: incomingAmount },
          customerId: customerResolution.customerId,
          customerMark: customerResolution.customerMark,
          customerName: customerResolution.customerName,
          customerPhone: customerResolution.customerPhone,
          customerCity: customerResolution.customerCity,
          needsCustomerFix: customerResolution.needsCustomerFix,
        },
      });
      await syncOrderAliases(tx, row.id, incomingOrderNo);
      return row;
    });
    await consolidateGroupedOrders({ invoiceIds: [updated.invoiceId] });
    await recordAuditEvent({
      action: auditActions.ORDER_ADD,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      targetId: updated.id,
      metadata: {
        merged: true,
        addedAmount: incomingAmount,
        orderNo: incomingOrderNo,
      },
    });
    return { data: updated, merged: true, message: '订单已合并' };
  }

  const order = await runInTransaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        invoiceId: payload.invoiceId,
        orderNo: incomingOrderNo,
        tokens: serializeOrderTokens(incomingOrderNo),
        amount: incomingAmount,
        orderBalance: incomingAmount,
        createdBy: currentUser.id,
        customerId: customerResolution.customerId,
        customerMark: customerResolution.customerMark,
        customerName: customerResolution.customerName,
        customerPhone: customerResolution.customerPhone,
        customerCity: customerResolution.customerCity,
        needsCustomerFix: customerResolution.needsCustomerFix,
      },
    });
    await syncOrderAliases(tx, created.id, incomingOrderNo);
    return created;
  });
  await consolidateGroupedOrders({ invoiceIds: [payload.invoiceId] });
  await recordAuditEvent({
    action: auditActions.ORDER_ADD,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: order.id,
    metadata: {
      merged: false,
      addedAmount: incomingAmount,
      orderNo: incomingOrderNo,
    },
  });
  return { data: order, merged: false, message: '订单已添加' };
}

export async function deleteInvoiceOrder(currentUser: CurrentUser, orderId: string) {
  if (!orderId) {
    throw badRequest('订单ID不能为空');
  }
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const order = await db.order.findFirst({
    where: {
      id: orderId,
      ...buildOrderVisibilityWhere(ownerIds),
    },
    select: { id: true, invoiceId: true },
  });
  if (!order) {
    throw notFound('订单不存在', { orderId });
  }
  const receipts = await db.receipt.findFirst({
    where: {
      orderId,
      ...buildReceiptVisibilityWhere(ownerIds),
    },
    select: { id: true },
  });
  if (receipts) {
    throw conflict('该订单下有收据，无法删除', { orderId });
  }

  await runInTransaction(async (tx) => {
    await tx.order.delete({ where: { id: orderId } });
    const remaining = await tx.order.count({ where: { invoiceId: order.invoiceId } });
    if (remaining === 0) {
      await tx.invoice.delete({ where: { id: order.invoiceId } });
    }
  });
  await recordAuditEvent({
    action: auditActions.ORDER_DELETE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: orderId,
    metadata: { invoiceId: order.invoiceId },
  });
  return { message: '订单已删除' };
}

export async function deleteInvoiceRecord(currentUser: CurrentUser, invoiceId: string) {
  if (!invoiceId) {
    throw badRequest('账单ID不能为空');
  }
  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const invoice = await db.invoice.findFirst({
    where: {
      id: invoiceId,
      ...buildInvoiceVisibilityWhere(ownerIds),
    },
    include: {
      orders: {
        select: { id: true },
      },
    },
  });
  if (!invoice) {
    throw notFound('账单不存在', { invoiceId });
  }
  const orderIds = invoice.orders.map((row) => row.id);
  const receipts = orderIds.length > 0
    ? await db.receipt.findFirst({ where: { orderId: { in: orderIds } }, select: { id: true } })
    : null;
  if (receipts) {
    throw conflict('该账单下有收据，无法删除', { invoiceId, receiptId: receipts.id });
  }

  await runInTransaction(async (tx) => {
    await tx.invoice.delete({ where: { id: invoiceId } });
  });
  await recordAuditEvent({
    action: auditActions.INVOICE_DELETE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.INVOICE,
    targetId: invoiceId,
  });
  return { message: '账单已删除' };
}

export async function transferInvoiceBalance(currentUser: CurrentUser, payload: {
  fromOrderId: string;
  toOrderNo: string;
  transferAmount: number;
}) {
  const { fromOrderId } = payload;
  const canonicalToOrderNo = canonicalizeOrderNo(typeof payload.toOrderNo === 'string' ? payload.toOrderNo : '');
  const transferAmount = Number(payload.transferAmount);

  if (!fromOrderId || !canonicalToOrderNo || transferAmount <= 0) {
    throw badRequest('缺少必要参数或金额无效');
  }

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const fromOrder = await db.order.findFirst({
    where: {
      id: fromOrderId,
      ...buildOrderVisibilityWhere(ownerIds),
    },
  });
  if (!fromOrder) {
    throw notFound('源订单不存在', { fromOrderId });
  }

  const fromReceipts = await db.receipt.findMany({ where: { orderId: fromOrderId } });
  const fromReceived = fromReceipts.reduce((sum, row) => sum + Number(row.usd), 0);
  const fromBalance = Number(fromOrder.amount) - fromReceived;
  if (fromBalance >= 0) {
    throw badRequest('该订单没有多付余额可转移', { fromOrderId, fromBalance });
  }
  if (transferAmount > Math.abs(fromBalance)) {
    throw badRequest(`转移金额不能超过多付金额 $${Math.abs(fromBalance).toFixed(2)}`, {
      fromOrderId,
      transferAmount,
      available: Math.abs(fromBalance),
    });
  }

  const matchedToOrderId = await findOrderIdByNoOrAlias(canonicalToOrderNo, buildOrderVisibilityWhere(ownerIds));
  let targetOrderId = matchedToOrderId;

  await runInTransaction(async (tx) => {
    let toOrder = targetOrderId
      ? await tx.order.findUnique({ where: { id: targetOrderId } })
      : null;

    if (!toOrder) {
      let unAssociated = await tx.invoice.findFirst({
        where: { invNo: 'Un_Associated' },
      });
      if (!unAssociated) {
        unAssociated = await tx.invoice.create({
          data: {
            invNo: 'Un_Associated',
            createdBy: currentUser.id,
          },
        });
      }
      toOrder = await tx.order.create({
        data: {
          invoiceId: unAssociated.id,
          orderNo: canonicalToOrderNo,
          tokens: serializeOrderTokens(canonicalToOrderNo),
          amount: 0,
          orderBalance: 0,
          createdBy: currentUser.id,
          needsCustomerFix: true,
        },
      });
      await syncOrderAliases(tx, toOrder.id, canonicalToOrderNo);
      targetOrderId = toOrder.id;
    }

    await tx.balanceTransfer.create({
      data: {
        fromOrderId,
        toOrderId: toOrder.id,
        amount: transferAmount,
        createdBy: currentUser.id,
      },
    });

    await tx.order.update({
      where: { id: fromOrderId },
      data: { amount: { increment: transferAmount } },
    });

    await tx.receipt.create({
      data: {
        receiptNo: `TRANSFER-${Date.now()}`,
        usd: transferAmount,
        orderNo: canonicalToOrderNo,
        payer: `余额转移自 ${fromOrder.orderNo}`,
        status: 'Bank_Transfer',
        orderId: toOrder.id,
        needsCustomerFix: true,
        note: `从订单 ${fromOrder.orderNo} 转移的余额`,
        createdBy: currentUser.id,
      },
    });
  });

  await updateOrderBalance(fromOrderId);
  if (targetOrderId) {
    await updateOrderBalance(targetOrderId);
  }

  await recordAuditEvent({
    action: auditActions.ORDER_TRANSFER_BALANCE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.ORDER,
    targetId: fromOrderId,
    metadata: {
      fromOrderId,
      toOrderNo: canonicalToOrderNo,
      toOrderId: targetOrderId,
      transferAmount,
    },
  });
  return { message: `成功转移 $${transferAmount.toFixed(2)} 到订单 ${canonicalToOrderNo}` };
}
