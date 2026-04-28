import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError, isApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { extractOrderNameFromOrderNo } from '@/lib/customer-matching';
import { canonicalizeOrderNo, normalizeOrderNo } from '@/lib/order-alias';
import { buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { getHierarchyScope } from '@/lib/user-hierarchy';

export const EXCEL_ML_FIELDS = [
  { index: 1, key: 'ORDER_NAME', label: 'ORDER NAME' },
  { index: 2, key: 'DISPLAY_NAME', label: 'COMPANY NAME / CUSTOMER NAME' },
  { index: 3, key: 'MARK', label: 'MARK' },
  { index: 4, key: 'CUSTOMER_NAME', label: 'CUSTOMER NAME' },
  { index: 5, key: 'COMPANY_NAME', label: 'COMPANY NAME' },
  { index: 6, key: 'PHONE', label: 'PHONE' },
  { index: 7, key: 'CITY', label: 'CITY' },
  { index: 8, key: 'CONSIGNEE', label: 'CONSIGNEE' },
  { index: 9, key: 'COMPANY_ADDRESS', label: 'COMPANY ADDRESS' },
  { index: 10, key: 'CREDIT', label: 'CREDIT' },
  { index: 11, key: 'CUSTOMER_ID', label: 'CUSTOMER ID' },
] as const;

type ExcelMlField = typeof EXCEL_ML_FIELDS[number];
type ExcelMlFieldKey = ExcelMlField['key'];
type ExcelMlMatchedBy = 'linked-order' | 'derived-order-name';

export type ExcelMlLookupInput = {
  orderNo: string;
  field: number;
};

type ExcelCustomer = {
  id: string;
  mark: string | null;
  orderName: string | null;
  name: string | null;
  phone: string | null;
  city: string | null;
  consignee?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  credit?: unknown;
};

export type ExcelMlLookupResult = {
  orderNo: string;
  derivedOrderName: string | null;
  field: number;
  fieldKey: ExcelMlFieldKey;
  fieldLabel: string;
  value: string;
  customerId: string;
  matchedBy: ExcelMlMatchedBy;
};

export type ExcelMlBatchResult =
  | (ExcelMlLookupResult & { success: true })
  | {
      success: false;
      orderNo: string;
      field: number;
      code: string;
      message: string;
      status: number;
    };

function getField(field: number): ExcelMlField {
  const numericField = Number(field);
  const match = EXCEL_ML_FIELDS.find((item) => item.index === numericField);
  if (!Number.isInteger(numericField) || !match) {
    throw createApiError({
      code: apiErrorCodes.EXCEL_FIELD_INVALID,
      status: 400,
      message: 'Excel字段编号无效',
      detail: { field, allowedFields: EXCEL_ML_FIELDS },
    });
  }
  return match;
}

function assertOrderMatched(orderNo: string, detail?: unknown): never {
  throw createApiError({
    code: apiErrorCodes.EXCEL_ORDER_NOT_FOUND,
    status: 404,
    message: 'Excel订单未匹配到客户',
    detail: { orderNo, ...((detail && typeof detail === 'object') ? detail : {}) },
  });
}

function assertOrderConflict(orderNo: string, detail?: unknown): never {
  throw createApiError({
    code: apiErrorCodes.EXCEL_ORDER_CONFLICT,
    status: 409,
    message: 'Excel订单匹配到多个客户',
    detail: { orderNo, ...((detail && typeof detail === 'object') ? detail : {}) },
  });
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

function fieldValue(customer: ExcelCustomer, fieldKey: ExcelMlFieldKey): string {
  switch (fieldKey) {
    case 'ORDER_NAME':
      return stringifyFieldValue(customer.orderName);
    case 'DISPLAY_NAME': {
      const companyName = stringifyFieldValue(customer.companyName).trim();
      return companyName || stringifyFieldValue(customer.name);
    }
    case 'MARK':
      return stringifyFieldValue(customer.mark);
    case 'CUSTOMER_NAME':
      return stringifyFieldValue(customer.name);
    case 'COMPANY_NAME':
      return stringifyFieldValue(customer.companyName);
    case 'PHONE':
      return stringifyFieldValue(customer.phone);
    case 'CITY':
      return stringifyFieldValue(customer.city);
    case 'CONSIGNEE':
      return stringifyFieldValue(customer.consignee);
    case 'COMPANY_ADDRESS':
      return stringifyFieldValue(customer.companyAddress);
    case 'CREDIT':
      return stringifyFieldValue(customer.credit);
    case 'CUSTOMER_ID':
      return stringifyFieldValue(customer.id);
  }
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

async function findCustomerForOrder(
  currentUser: CurrentUser,
  orderNo: string,
): Promise<{ customer: ExcelCustomer; matchedBy: ExcelMlMatchedBy; derivedOrderName: string | null }> {
  const rawOrderNo = String(orderNo || '').trim();
  if (!rawOrderNo) assertOrderMatched(orderNo, { reason: 'empty-order-no' });

  const scope = await getHierarchyScope(currentUser);
  const ownerIds = Array.from(scope.ownerVisibleIds);
  const visibilityWhere = buildOrderVisibilityWhere(ownerIds);
  const normalizedOrderNo = normalizeOrderNo(rawOrderNo);
  const canonicalOrderNo = canonicalizeOrderNo(rawOrderNo);
  const derivedOrderName = extractOrderNameFromOrderNo(rawOrderNo);

  const exactOrders = await db.order.findMany({
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
      createdAt: true,
      customer: {
        select: {
          id: true,
          mark: true,
          orderName: true,
          name: true,
          phone: true,
          city: true,
          consignee: true,
          companyName: true,
          companyAddress: true,
          credit: true,
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

  const linkedCustomersById = new Map<string, ExcelCustomer>();
  for (const order of sortExactOrders(exactOrders)) {
    if (order.customer?.id && !linkedCustomersById.has(order.customer.id)) {
      linkedCustomersById.set(order.customer.id, order.customer);
    }
  }

  if (linkedCustomersById.size === 1) {
    return {
      customer: Array.from(linkedCustomersById.values())[0],
      matchedBy: 'linked-order',
      derivedOrderName,
    };
  }

  if (linkedCustomersById.size > 1) {
    assertOrderConflict(rawOrderNo, { mode: 'linked-order', customerIds: Array.from(linkedCustomersById.keys()) });
  }

  if (!derivedOrderName) {
    assertOrderMatched(rawOrderNo, { reason: 'order-name-not-derived' });
  }

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
      consignee: true,
      companyName: true,
      companyAddress: true,
      credit: true,
    },
    orderBy: [{ createdAt: 'desc' }],
  });

  if (matchedCustomers.length === 0) {
    assertOrderMatched(rawOrderNo, { derivedOrderName });
  }

  if (matchedCustomers.length > 1) {
    assertOrderConflict(rawOrderNo, {
      mode: 'derived-order-name',
      derivedOrderName,
      customerIds: matchedCustomers.map((customer) => customer.id),
    });
  }

  return {
    customer: matchedCustomers[0],
    matchedBy: 'derived-order-name',
    derivedOrderName,
  };
}

export async function resolveExcelMlValue(
  currentUser: CurrentUser,
  input: ExcelMlLookupInput,
  options: { audit?: boolean } = {},
): Promise<ExcelMlLookupResult> {
  const field = getField(input.field);
  const rawOrderNo = String(input.orderNo || '').trim();
  const { customer, matchedBy, derivedOrderName } = await findCustomerForOrder(currentUser, rawOrderNo);
  const result: ExcelMlLookupResult = {
    orderNo: rawOrderNo,
    derivedOrderName,
    field: field.index,
    fieldKey: field.key,
    fieldLabel: field.label,
    value: fieldValue(customer, field.key),
    customerId: customer.id,
    matchedBy,
  };

  if (options.audit !== false) {
    await recordAuditEvent({
      action: auditActions.EXCEL_ML_LOOKUP,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EXCEL_ML_LOOKUP,
      targetId: customer.id,
      metadata: {
        orderNo: rawOrderNo,
        field: field.index,
        fieldKey: field.key,
        matchedBy,
        derivedOrderName,
      },
    });
  }

  return result;
}

export async function resolveExcelMlBatch(
  currentUser: CurrentUser,
  items: ExcelMlLookupInput[],
): Promise<ExcelMlBatchResult[]> {
  const results: ExcelMlBatchResult[] = [];

  for (const item of items) {
    try {
      const result = await resolveExcelMlValue(currentUser, item, { audit: false });
      results.push({ ...result, success: true });
    } catch (error) {
      if (isApiError(error)) {
        results.push({
          success: false,
          orderNo: String(item.orderNo || '').trim(),
          field: Number(item.field),
          code: error.code,
          message: error.message,
          status: error.status,
        });
      } else {
        results.push({
          success: false,
          orderNo: String(item.orderNo || '').trim(),
          field: Number(item.field),
          code: apiErrorCodes.INTERNAL_ERROR,
          message: '服务器错误',
          status: 500,
        });
      }
    }
  }

  const successCount = results.filter((result) => result.success).length;
  await recordAuditEvent({
    action: auditActions.EXCEL_ML_BATCH_LOOKUP,
    actorId: currentUser.id,
    targetType: auditTargetTypes.EXCEL_ML_LOOKUP,
    metadata: {
      count: results.length,
      successCount,
      failureCount: results.length - successCount,
    },
  });

  return results;
}
