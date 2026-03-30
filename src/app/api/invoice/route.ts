import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { UserRole } from '@prisma/client';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse, localizeApiSuccessMessage } from '@/lib/api-success-response';
import {
  addInvoiceOrder,
  assignInvoiceToBranchAdmin,
  applyInvoiceRematch,
  createInvoiceRecord,
  deleteInvoiceOrder,
  deleteInvoiceRecord,
  parseDateInput,
  previewInvoiceRematch,
  processInvoiceImportRows,
  rematchInvoices,
  transferInvoiceBalance,
  updateInvoiceDates,
  updateInvoiceOrder,
  type InvoiceImportInputRow,
} from '@/lib/invoice-service';
import {
  listInvoiceRecords,
  listOrderMatchCandidates,
  listOrderReceiptRecords,
} from '@/lib/invoice-read-service';
import { withAuth, withRole } from '@/lib/route-auth';
import { parseJsonRequest } from '@/lib/http-body';

function mapInvoiceImportRows(rowsInput: unknown[]): InvoiceImportInputRow[] {
  return rowsInput.map((row, index) => {
    const record = row as Record<string, unknown>;
    return {
      rowNo: Number(record.rowNo) || index + 1,
      invNo: String(record.invNo || '').trim(),
      shipDateRaw: String(record.shipDate || '').trim(),
      releaseDateRaw: String(record.releaseDate || '').trim(),
      orderNo: String(record.orderNo || '').trim(),
      amountRaw: String(record.amount || '').trim(),
      customerMark: String(record.customerMark || '').trim(),
      customerName: String(record.customerName || '').trim(),
      customerId: String(record.customerId || '').trim(),
    };
  });
}

function toImportResponse(
  processed: Awaited<ReturnType<typeof processInvoiceImportRows>>,
  request?: NextRequest,
) {
  const localizedMessage = processed.success
    ? localizeApiSuccessMessage(processed.message, request)
    : processed.message;
  return NextResponse.json(
    {
      success: processed.success,
      message: localizedMessage,
      error: processed.success ? undefined : processed.message,
      details: processed.details.slice(0, 200),
      issueRows: processed.issueRows.slice(0, 200),
      rowResults: processed.rowResults,
      data: {
        importedOrderNos: processed.importedOrderNos.slice(0, 500),
      },
    },
    { status: processed.status }
  );
}

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const action = (searchParams.get('action') || '').trim();
    const search = (searchParams.get('search') || '').trim();
    const orderId = searchParams.get('orderId');
    const orderNo = (searchParams.get('orderNo') || '').trim();

    if (action === 'import-template') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('invoice_import');
      sheet.columns = [
        { header: 'INV_NO', key: 'invNo', width: 22 },
        { header: 'SHIP_DATE', key: 'shipDate', width: 16 },
        { header: 'RELEASE_DATE', key: 'releaseDate', width: 16 },
        { header: 'ORDER_NO', key: 'orderNo', width: 26 },
        { header: 'AMOUNT', key: 'amount', width: 14 },
        { header: 'CUSTOMER_MARK', key: 'customerMark', width: 22 },
        { header: 'CUSTOMER_ORDER_NAME', key: 'customerName', width: 24 },
        { header: 'CUSTOMER_ID', key: 'customerId', width: 28 },
      ];
      sheet.addRow({
        invNo: 'INV-2026-001',
        shipDate: '2026-03-01',
        releaseDate: '2026-03-03',
        orderNo: 'IB-31A/IB-32/IB-33B',
        amount: 1200,
        customerMark: 'IB',
        customerName: 'IB',
        customerId: '',
      });
      sheet.getRow(1).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(new Blob([buffer]), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="invoice-import-template.xlsx"',
          'X-Success-Message': encodeURIComponent(localizeApiSuccessMessage('账单导入模板已生成', request) || ''),
        },
      });
    }

    if (orderId) {
      const result = await listOrderReceiptRecords(currentUser, orderId);
      return createApiSuccessResponse(result, request);
    }

    if (orderNo) {
      const result = await listOrderMatchCandidates(currentUser, orderNo);
      return createApiSuccessResponse(result, request);
    }

    const result = await listInvoiceRecords(currentUser, search);
    return createApiSuccessResponse(result, request);
  } catch (error) {
    console.error('Get invoices error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});

export const POST = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest, currentUser) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const action = String(form.get('action') || '');
      if (action !== 'import-excel') {
        throw createApiError({
          code: 'INVALID_ACTION',
          status: 400,
          message: '未知上传操作',
          detail: { action },
        });
      }

      const file = form.get('file');
      if (!(file instanceof File)) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: '请上传Excel文件',
        });
      }

      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      const workbookBuffer = Buffer.from(arrayBuffer) as unknown as Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(workbookBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: 'Excel为空',
        });
      }

      const headerRow = sheet.getRow(1);
      const headerMap = new Map<string, number>();
      for (let i = 1; i <= sheet.columnCount; i++) {
        const raw = String(headerRow.getCell(i).value || '').trim().toUpperCase();
        if (raw) headerMap.set(raw, i);
      }
      const required = ['INV_NO', 'ORDER_NO', 'AMOUNT'];
      const missing = required.filter((header) => !headerMap.has(header));
      if (missing.length > 0) {
        throw createApiError({
          code: 'BAD_REQUEST',
          status: 400,
          message: `模板缺少列: ${missing.join(', ')}`,
          detail: { missing },
        });
      }

      const importRows: InvoiceImportInputRow[] = [];
      for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo++) {
        const row = sheet.getRow(rowNo);
        const invNo = headerMap.get('INV_NO') ? String(row.getCell(headerMap.get('INV_NO')!).value || '').trim() : '';
        const shipDateRaw = headerMap.get('SHIP_DATE') ? String(row.getCell(headerMap.get('SHIP_DATE')!).value || '').trim() : '';
        const releaseDateRaw = headerMap.get('RELEASE_DATE') ? String(row.getCell(headerMap.get('RELEASE_DATE')!).value || '').trim() : '';
        const orderNo = headerMap.get('ORDER_NO') ? String(row.getCell(headerMap.get('ORDER_NO')!).value || '').trim() : '';
        const amountRaw = headerMap.get('AMOUNT') ? String(row.getCell(headerMap.get('AMOUNT')!).value || '').trim() : '';
        const customerMark = headerMap.get('CUSTOMER_MARK') ? String(row.getCell(headerMap.get('CUSTOMER_MARK')!).value || '').trim() : '';
        const customerOrderNameCol = headerMap.get('CUSTOMER_ORDER_NAME');
        const customerIdCol = headerMap.get('CUSTOMER_ID');
        const customerName = customerOrderNameCol ? String(row.getCell(customerOrderNameCol).value || '').trim() : '';
        const customerId = customerIdCol ? String(row.getCell(customerIdCol).value || '').trim() : '';

        if (!invNo && !orderNo && !amountRaw && !customerMark && !shipDateRaw && !releaseDateRaw) continue;
        importRows.push({
          rowNo,
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

      const processed = await processInvoiceImportRows(importRows, currentUser);
      return toImportResponse(processed, request);
    }

    const body = await parseJsonRequest<Record<string, unknown>>(request);
    if (body?.action === 'import-rows') {
      const rowsInput = Array.isArray(body?.rows) ? body.rows : [];
      const processed = await processInvoiceImportRows(mapInvoiceImportRows(rowsInput), currentUser);
      return toImportResponse(processed, request);
    }

    const parsedShipDate = parseDateInput(body?.shipDate);
    const parsedReleaseDate = parseDateInput(body?.releaseDate);
    if (body?.shipDate && parsedShipDate === undefined) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: 'SHIP_DATE 格式错误，应为 YYYY-MM-DD',
      });
    }
    if (body?.releaseDate && parsedReleaseDate === undefined) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: 'RELEASE_DATE 格式错误，应为 YYYY-MM-DD',
      });
    }

    const result = await createInvoiceRecord(currentUser, {
      invNo: String(body?.invNo || ''),
      orders: Array.isArray(body?.orders) ? body.orders : [],
      shipDate: parsedShipDate,
      releaseDate: parsedReleaseDate,
    });
    return createApiSuccessResponse({ data: result.data, message: result.message }, request);
  } catch (error) {
    console.error('Create invoice error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
}, '只有管理员和销售代表可以创建账单');

export const DELETE = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const result = await deleteInvoiceRecord(currentUser, searchParams.get('id') || '');
    return createApiSuccessResponse({ message: result.message }, request);
  } catch (error) {
    console.error('Delete invoice error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
}, '只有管理员和销售代表可以删除账单');

export const PUT = withRole([UserRole.ADMIN, UserRole.SALES], async (request: NextRequest, currentUser) => {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request);
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'rematch-preview') {
      const data = await previewInvoiceRematch(currentUser);
      return NextResponse.json({ success: true, data });
    }

    if (action === 'rematch-apply') {
      const result = await applyInvoiceRematch(
        currentUser,
        Array.isArray(body?.resolutions) ? body.resolutions : []
      );
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'rematch') {
      const result = await rematchInvoices(currentUser);
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'updateInvoiceDates') {
      const result = await updateInvoiceDates(currentUser, {
        invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : '',
        shipDate: body.shipDate,
        releaseDate: body.releaseDate,
      });
      return createApiSuccessResponse({ data: result.data, message: result.message }, request);
    }

    if (action === 'assignBranchAdmin') {
      const result = await assignInvoiceToBranchAdmin(currentUser, {
        invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : '',
        targetAdminId: typeof body.targetAdminId === 'string' ? body.targetAdminId : '',
      });
      return createApiSuccessResponse({ data: result.data, message: result.message }, request);
    }

    if (action === 'updateOrder') {
      const result = await updateInvoiceOrder(currentUser, {
        orderId: typeof body.orderId === 'string' ? body.orderId : '',
        orderNo: typeof body.orderNo === 'string' ? body.orderNo : undefined,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        customerMark: typeof body.customerMark === 'string' ? body.customerMark : undefined,
        customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
        customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
        customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone : undefined,
        customerCity: typeof body.customerCity === 'string' ? body.customerCity : undefined,
      });
      return createApiSuccessResponse({ data: result.data, message: result.message }, request);
    }

    if (action === 'addOrder') {
      const result = await addInvoiceOrder(currentUser, {
        invoiceId: typeof body.invoiceId === 'string' ? body.invoiceId : '',
        orderNo: typeof body.orderNo === 'string' ? body.orderNo : '',
        amount: Number(body.amount),
        customerMark: typeof body.customerMark === 'string' ? body.customerMark : '',
        customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
        customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
      });
      return createApiSuccessResponse({ data: result.data, merged: result.merged, message: result.message }, request);
    }

    if (action === 'deleteOrder') {
      const result = await deleteInvoiceOrder(currentUser, typeof body?.orderId === 'string' ? body.orderId : '');
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'transferBalance') {
      const result = await transferInvoiceBalance(currentUser, {
        fromOrderId: typeof body.fromOrderId === 'string' ? body.fromOrderId : '',
        toOrderNo: typeof body.toOrderNo === 'string' ? body.toOrderNo : '',
        transferAmount: Number(body.transferAmount),
      });
      return createApiSuccessResponse({ message: result.message }, request);
    }

    throw createApiError({
      code: 'INVALID_ACTION',
      status: 400,
      message: '未知操作',
      detail: { action },
    });
  } catch (error) {
    console.error('Update order error:', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
}, '只有管理员和销售代表可以修改订单');
