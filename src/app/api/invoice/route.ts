import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse, localizeApiSuccessMessage } from '@/lib/api-success-response';
import {
  addInvoiceOrder,
  applyInvoiceRematch,
  buildOrderVisibilityWhere,
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
import { deriveOrderGroupKey } from '@/lib/order-group';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { withAuth, withRole } from '@/lib/route-auth';
import { filterRowsBySearch } from '@/lib/text-search';
import { getHierarchyScope } from '@/lib/user-hierarchy';

function buildInvoiceVisibilityWhere(ownerIds: string[]) {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { orders: { some: { createdBy: { in: ownerIds } } } },
      { orders: { some: { customer: { createdBy: { in: ownerIds } } } } },
    ],
  };
}

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
    const scope = await getHierarchyScope(currentUser);
    const ownerIds = Array.from(scope.ownerVisibleIds);
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
        },
      });
    }

    if (orderId) {
      const accessibleOrder = await db.order.findFirst({
        where: {
          id: orderId,
          ...buildOrderVisibilityWhere(ownerIds),
        },
        select: { id: true },
      });
      if (!accessibleOrder) return NextResponse.json({ success: true, data: [] });

      const receipts = await db.receipt.findMany({
        where: {
          orderId,
          OR: [
            { createdBy: { in: ownerIds } },
            { customer: { createdBy: { in: ownerIds } } },
          ],
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
      return NextResponse.json({ success: true, data: receipts });
    }

    if (orderNo) {
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
        return NextResponse.json({ success: true, data: matchedOrder ? [matchedOrder] : [] });
      }

      const targetKey = deriveOrderGroupKey(orderNo);
      if (!targetKey) {
        return NextResponse.json({ success: true, data: [] });
      }
      const allOrders = await db.order.findMany({
        where: visibilityWhere,
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
        orderBy: { createdAt: 'desc' },
      });
      const matched = allOrders.filter((row) => deriveOrderGroupKey(row.orderNo) === targetKey);
      return NextResponse.json({ success: true, data: matched });
    }

    const invoices = await db.invoice.findMany({
      where: buildInvoiceVisibilityWhere(ownerIds),
      include: {
        orders: {
          where: buildOrderVisibilityWhere(ownerIds),
          include: {
            receipts: {
              where: {
                orderId: { not: null },
                OR: [
                  { createdBy: { in: ownerIds } },
                  { customer: { createdBy: { in: ownerIds } } },
                ],
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

    const searchedResult = filterRowsBySearch(result, search);
    searchedResult.sort((a, b) => {
      const rank = (invNo: string) => {
        if (invNo === 'DEPOSIT_POOL') return 0;
        if (invNo === 'Un_Associated') return 1;
        return 2;
      };
      const rankA = rank(a.invNo);
      const rankB = rank(b.invNo);
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ success: true, data: searchedResult });
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

    const body = await request.json();
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
    const body = await request.json();
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
      const result = await updateInvoiceDates(currentUser, body ?? {});
      return createApiSuccessResponse({ data: result.data, message: result.message }, request);
    }

    if (action === 'updateOrder') {
      const result = await updateInvoiceOrder(currentUser, body ?? {});
      return createApiSuccessResponse({ data: result.data, message: result.message }, request);
    }

    if (action === 'addOrder') {
      const result = await addInvoiceOrder(currentUser, body ?? {});
      return createApiSuccessResponse({ data: result.data, merged: result.merged, message: result.message }, request);
    }

    if (action === 'deleteOrder') {
      const result = await deleteInvoiceOrder(currentUser, typeof body?.orderId === 'string' ? body.orderId : '');
      return createApiSuccessResponse({ message: result.message }, request);
    }

    if (action === 'transferBalance') {
      const result = await transferInvoiceBalance(currentUser, body ?? {});
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
