import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { type ApiErrorCode, apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse, localizeApiSuccessMessage } from '@/lib/api-success-response';
import { parseJsonRequest } from '@/lib/http-body';
import { withAuth } from '@/lib/route-auth';
import { customerAccessWhere, mapPrismaWriteError, resolveCustomerOwnerId } from '@/lib/customer-scope';
import {
  createCustomerRecord,
  deleteCustomerRecord,
  processCustomerImportRows,
  updateCustomerRecord,
  type CustomerPayload,
  type ImportRow,
} from '@/lib/customer-service';
import {
  getCustomerOrderNameHistory,
  listCustomerOwnerOptions,
  listCustomers,
} from '@/lib/customer-read-service';
import {
  addCustomerConsignee,
  deleteCustomerConsignee,
  listCustomerConsignees,
} from '@/lib/customer-consignee-service';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function managerOnly(userRole: UserRole, request?: NextRequest): NextResponse | null {
  if (userRole === UserRole.ADMIN || userRole === UserRole.SALES) return null;
  return createApiErrorResponse({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' }, request);
}

function badRequest(message: string, code: ApiErrorCode = apiErrorCodes.BAD_REQUEST, detail?: unknown, request?: NextRequest) {
  return createApiErrorResponse({ code, status: 400, message, detail }, request);
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

function localizeCustomerResponseData<T>(value: T, request: NextRequest): T {
  if (Array.isArray(value)) {
    return value.map((item) => localizeCustomerResponseData(item, request)) as T;
  }
  if (!value || typeof value !== 'object') return value;

  const row = value as Record<string, unknown>;
  const nextRow: Record<string, unknown> = { ...row };
  if (typeof row.phoneConflictMessage === 'string' && row.phoneConflictMessage) {
    nextRow.phoneConflictMessage = localizeApiSuccessMessage(row.phoneConflictMessage, request) || row.phoneConflictMessage;
  }
  return nextRow as T;
}

function parsePayload(body: Record<string, unknown>): CustomerPayload {
  const orderNames = Array.isArray(body.orderNames)
    ? body.orderNames.map((value) => trimStr(value)).filter(Boolean)
    : [];
  return {
    mark: trimStr(body.mark),
    orderName: trimStr(body.orderName),
    orderNames,
    name: trimStr(body.name),
    phone: trimStr(body.phone),
    city: trimStr(body.city),
    consignee: trimStr(body.consignee) || null,
    companyName: trimStr(body.companyName) || null,
    companyAddress: trimStr(body.companyAddress) || null,
    credit: body.credit === null || body.credit === undefined || body.credit === '' ? null : Number(body.credit),
  };
}

function buildImportResponse(processed: Awaited<ReturnType<typeof processCustomerImportRows>>, request: NextRequest) {
  const localizedMessage = processed.success
    ? localizeApiSuccessMessage(processed.message, request)
    : processed.message;

  return NextResponse.json(
    {
      success: processed.success,
      message: localizedMessage,
      error: processed.success ? undefined : processed.message,
      code: processed.success ? undefined : apiErrorCodes.BAD_REQUEST,
      details: processed.details.slice(0, 200),
      issueRows: processed.issueRows.slice(0, 200),
      rowResults: processed.rowResults,
      data: {
        createdCount: processed.createdCount,
        updatedCount: processed.updatedCount,
        failedCount: processed.issueRows.length,
        createdRows: processed.createdRows.slice(0, 500),
        updatedRows: processed.updatedRows.slice(0, 500),
      },
    },
    { status: processed.status },
  );
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const action = trimStr(searchParams.get('action'));
  const mark = trimStr(searchParams.get('mark'));
  const search = trimStr(searchParams.get('search'));

  if (action === 'owner-options') {
    const result = await listCustomerOwnerOptions(currentUser);
    return createApiSuccessResponse(result, request);
  }

  if (action === 'order-history') {
    const result = await getCustomerOrderNameHistory(currentUser, {
      customerId: trimStr(searchParams.get('customerId')),
      orderName: trimStr(searchParams.get('orderName')),
    });
    return createApiSuccessResponse(result, request);
  }

  if (action === 'consignees') {
    const result = await listCustomerConsignees(currentUser, trimStr(searchParams.get('customerId')));
    return createApiSuccessResponse(result, request);
  }

  if (action === 'import-template') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('customer_import');
    sheet.columns = [
      { header: 'MARK', key: 'mark', width: 18 },
      { header: 'ORDER_NAME', key: 'orderName', width: 22 },
      { header: 'NAME', key: 'name', width: 22 },
      { header: 'PHONE', key: 'phone', width: 18 },
      { header: 'CITY', key: 'city', width: 18 },
      { header: 'CONSIGNEE', key: 'consignee', width: 20 },
      { header: 'COMPANY_NAME', key: 'companyName', width: 24 },
      { header: 'CREDIT', key: 'credit', width: 12 },
      { header: 'COMPANY_ADDRESS', key: 'companyAddress', width: 30 },
      { header: 'SALES_EMAIL', key: 'salesEmail', width: 28 },
    ];
    sheet.addRow({
      mark: 'MAB-1',
      orderName: 'MAB-1',
      name: 'MAB TRADING',
      phone: '622443103',
      city: 'Conakry',
      consignee: 'Ahmadou Diallo',
      companyName: 'MAB Co.,Ltd',
      credit: 30000,
      companyAddress: 'Conakry, Guinea',
      salesEmail: '',
    });
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Blob([buffer]), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="customer-import-template.xlsx"',
        'X-Success-Message': encodeURIComponent(localizeApiSuccessMessage('客户导入模板已生成', request) || ''),
      },
    });
  }

  const result = await listCustomers(currentUser, { mark, search });
  return createApiSuccessResponse({ ...result, data: localizeCustomerResponseData(result.data, request) }, request);
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const action = trimStr(formData.get('action'));
      if (action !== 'import-excel') {
        return badRequest('未知上传操作', apiErrorCodes.INVALID_ACTION, { action }, request);
      }

      const file = formData.get('file');
      if (!(file instanceof File)) {
        return badRequest('请上传Excel文件', apiErrorCodes.INVALID_FILE_TYPE, undefined, request);
      }

      let ownerId: string;
      try {
        ownerId = await resolveCustomerOwnerId(currentUser, trimStr(formData.get('ownerId')) || null);
      } catch (error) {
        return badRequest(mapPrismaWriteError(error), apiErrorCodes.BAD_REQUEST, undefined, request);
      }

      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      const workbookBuffer = Buffer.from(arrayBuffer) as unknown as Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(workbookBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        return badRequest('Excel为空', apiErrorCodes.IMPORT_EMPTY_FILE, undefined, request);
      }

      const headerRow = sheet.getRow(1);
      const headerMap = new Map<string, number>();
      for (let i = 1; i <= sheet.columnCount; i++) {
        const key = trimStr(headerRow.getCell(i).value).toUpperCase();
        if (key) headerMap.set(key, i);
      }
      const requiredHeaders = ['MARK', 'ORDER_NAME', 'NAME', 'PHONE', 'CITY', 'CONSIGNEE'];
      const missing = requiredHeaders.filter((header) => !headerMap.has(header));
      if (missing.length > 0) {
        return badRequest(`模板缺少列: ${missing.join(', ')}`, apiErrorCodes.IMPORT_TEMPLATE_INVALID, { missing }, request);
      }

      const rows: ImportRow[] = [];
      for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
        const row = sheet.getRow(rowNo);
        const payload: CustomerPayload = {
          mark: trimStr(row.getCell(headerMap.get('MARK')!).value),
          orderName: trimStr(row.getCell(headerMap.get('ORDER_NAME')!).value),
          name: trimStr(row.getCell(headerMap.get('NAME')!).value),
          phone: trimStr(row.getCell(headerMap.get('PHONE')!).value),
          city: trimStr(row.getCell(headerMap.get('CITY')!).value),
          consignee: trimStr(row.getCell(headerMap.get('CONSIGNEE')!).value) || null,
          companyName: headerMap.has('COMPANY_NAME') ? trimStr(row.getCell(headerMap.get('COMPANY_NAME')!).value) || null : null,
          companyAddress: headerMap.has('COMPANY_ADDRESS') ? trimStr(row.getCell(headerMap.get('COMPANY_ADDRESS')!).value) || null : null,
          credit: headerMap.has('CREDIT')
            ? (() => {
                const raw = trimStr(row.getCell(headerMap.get('CREDIT')!).value);
                if (!raw) return null;
                const num = Number(raw);
                return Number.isFinite(num) ? num : Number.NaN;
              })()
            : null,
        };

        if (!payload.mark && !payload.orderName && !payload.name && !payload.phone && !payload.city && !payload.consignee) continue;
        rows.push({
          rowNo,
          payload,
          ownerEmail: headerMap.has('SALES_EMAIL') ? trimStr(row.getCell(headerMap.get('SALES_EMAIL')!).value).toLowerCase() || null : null,
        });
      }

      if (rows.length === 0) {
        return badRequest('没有可导入的数据行', apiErrorCodes.NO_IMPORT_ROWS, undefined, request);
      }

      const processed = await processCustomerImportRows(rows, currentUser, ownerId);
      return buildImportResponse(processed, request);
    }

    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const action = trimStr(body.action);

    if (action === 'import-rows') {
      const rowsInput = Array.isArray(body.rows) ? body.rows : [];
      const rows: ImportRow[] = rowsInput.map((raw, index) => {
        const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const creditRaw = trimStr(row.credit);
        const credit = creditRaw === '' ? null : Number(creditRaw);
        return {
          rowNo: Number(row.rowNo) || index + 1,
          ownerEmail: trimStr(row.ownerEmail).toLowerCase() || null,
          payload: {
            mark: trimStr(row.mark),
            orderName: trimStr(row.orderName),
            name: trimStr(row.name),
            phone: trimStr(row.phone),
            city: trimStr(row.city),
            consignee: trimStr(row.consignee) || null,
            companyName: trimStr(row.companyName) || null,
            companyAddress: trimStr(row.companyAddress) || null,
            credit: creditRaw === '' ? null : (Number.isFinite(credit) ? credit : Number.NaN),
          },
        };
      });
      if (rows.length === 0) {
        return badRequest('没有可导入的数据行', apiErrorCodes.NO_IMPORT_ROWS, undefined, request);
      }

      let ownerId: string;
      try {
        ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || null);
      } catch (error) {
        return badRequest(mapPrismaWriteError(error), apiErrorCodes.BAD_REQUEST, undefined, request);
      }

      const processed = await processCustomerImportRows(rows, currentUser, ownerId);
      return buildImportResponse(processed, request);
    }

    if (action === 'create') {
      const result = await createCustomerRecord(currentUser, parsePayload(body), trimStr(body.ownerId) || null);
      if (currentUser.role === UserRole.ADMIN) {
        return createApiSuccessResponse({ data: localizeCustomerResponseData(result.data, request), message: result.message }, request);
      }
      return createApiSuccessResponse({
        data: localizeCustomerResponseData(toSalesView(result.data as Record<string, unknown>, result.showExtended), request),
        message: result.message,
      }, request);
    }

    if (action === 'update') {
      const result = await updateCustomerRecord(currentUser, trimStr(body.id), parsePayload(body), trimStr(body.ownerId) || null);
      if (currentUser.role === UserRole.ADMIN) {
        return createApiSuccessResponse({ data: localizeCustomerResponseData(result.data, request), message: result.message }, request);
      }
      return createApiSuccessResponse({
        data: localizeCustomerResponseData(toSalesView(result.data as Record<string, unknown>, result.showExtended), request),
        message: result.message,
      }, request);
    }

    if (action === 'delete') {
      const result = await deleteCustomerRecord(currentUser, trimStr(body.id));
      return createApiSuccessResponse(result, request);
    }

    if (action === 'consignee-add') {
      const result = await addCustomerConsignee(currentUser, trimStr(body.customerId), body.consignee);
      return createApiSuccessResponse(result, request);
    }

    if (action === 'consignee-delete') {
      const result = await deleteCustomerConsignee(currentUser, trimStr(body.customerId), trimStr(body.consigneeId));
      return createApiSuccessResponse(result, request);
    }

    return badRequest('未知操作', apiErrorCodes.INVALID_ACTION, { action }, request);
  } catch (error) {
    console.error('Customer POST error:', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
