import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError, isApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { resolveOrderCustomer, type OrderCustomerLookupCustomer, type OrderCustomerLookupMatchedBy } from '@/lib/order-customer-lookup-service';

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
type ExcelMlMatchedBy = OrderCustomerLookupMatchedBy;

export type ExcelMlLookupInput = {
  orderNo: string;
  field: number;
};

type ExcelCustomer = OrderCustomerLookupCustomer;

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

async function findCustomerForOrder(
  currentUser: CurrentUser,
  orderNo: string,
): Promise<{ customer: ExcelCustomer; matchedBy: ExcelMlMatchedBy; derivedOrderName: string | null }> {
  const result = await resolveOrderCustomer(currentUser, orderNo);
  return {
    customer: result.customer,
    matchedBy: result.matchedBy,
    derivedOrderName: result.derivedOrderName,
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
