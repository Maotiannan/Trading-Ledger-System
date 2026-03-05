import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  canMutateCustomer,
  customerAccessWhere,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
  resolveCustomerUpsertTargetId,
} from '@/lib/customer-scope';

type CustomerPayload = {
  mark?: string;
  orderName?: string;
  name?: string;
  phone?: string;
  city?: string;
  consignee?: string | null;
  companyName?: string | null;
  credit?: number | null;
  companyAddress?: string | null;
};

type ImportRow = {
  rowNo: number;
  payload: CustomerPayload;
};

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function managerOnly(userRole: UserRole): NextResponse | null {
  if (userRole === UserRole.ADMIN || userRole === UserRole.SALES) return null;
  return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
}

function parsePayload(body: Record<string, unknown>): CustomerPayload {
  return {
    mark: trimStr(body.mark),
    orderName: trimStr(body.orderName),
    name: trimStr(body.name),
    phone: trimStr(body.phone),
    city: trimStr(body.city),
    consignee: trimStr(body.consignee) || null,
    companyName: trimStr(body.companyName) || null,
    companyAddress: trimStr(body.companyAddress) || null,
    credit: body.credit === null || body.credit === undefined || body.credit === '' ? null : Number(body.credit),
  };
}

async function canSalesEditExtendedFields(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

function validateRequired(payload: CustomerPayload): string | null {
  if (!payload.mark) return 'MARK不能为空';
  if (!payload.orderName) return 'ORDER_NAME不能为空';
  if (!payload.name) return 'NAME不能为空';
  if (!payload.phone) return 'PHONE不能为空';
  if (!payload.city) return 'CITY不能为空';
  if ((payload.mark?.length || 0) > 191) return 'MARK长度不能超过191';
  if ((payload.orderName?.length || 0) > 191) return 'ORDER_NAME长度不能超过191';
  if ((payload.phone?.length || 0) > 191) return 'PHONE长度不能超过191';
  if ((payload.city?.length || 0) > 191) return 'CITY长度不能超过191';
  if (payload.credit !== null && payload.credit !== undefined) {
    if (!Number.isFinite(payload.credit) || payload.credit < 0) return 'CREDIT必须为大于等于0的数字';
  }
  return null;
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

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const action = trimStr(searchParams.get('action'));
  const mark = trimStr(searchParams.get('mark'));
  const search = trimStr(searchParams.get('search'));

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
    });
    sheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="customer-import-template.xlsx"',
      },
    });
  }

  const where: Record<string, unknown> = {
    ...customerAccessWhere(currentUser),
  };
  if (mark) {
    where.mark = { equals: mark };
  } else if (search) {
    where.OR = [
      { mark: { contains: search } },
      { orderName: { contains: search } },
      { name: { contains: search } },
      { phone: { contains: search } },
      { city: { contains: search } },
      { consignee: { contains: search } },
    ];
  }

  const rows = await db.customer.findMany({
    where,
    orderBy: [{ mark: 'asc' }, { createdAt: 'desc' }],
  });

  if (currentUser.role === UserRole.ADMIN) {
    return NextResponse.json({ success: true, data: rows });
  }

  const showExtended = await canSalesEditExtendedFields();
  return NextResponse.json({ success: true, data: rows.map((row) => toSalesView(row as Record<string, unknown>, showExtended)) });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const action = trimStr(formData.get('action'));
    if (action !== 'import-excel') {
      return NextResponse.json({ success: false, error: '未知上传操作' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: '请上传Excel文件' }, { status: 400 });
    }

    let ownerId: string;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(formData.get('ownerId')) || null);
    } catch (error) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(error) }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = await file.arrayBuffer();
    await workbook.xlsx.load(Buffer.from(arrayBuffer));
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return NextResponse.json({ success: false, error: 'Excel为空' }, { status: 400 });
    }

    const headerRow = sheet.getRow(1);
    const headerMap = new Map<string, number>();
    for (let i = 1; i <= sheet.columnCount; i++) {
      const key = trimStr(headerRow.getCell(i).value).toUpperCase();
      if (key) headerMap.set(key, i);
    }
    const requiredHeaders = ['MARK', 'ORDER_NAME', 'NAME', 'PHONE', 'CITY', 'CONSIGNEE'];
    const missing = requiredHeaders.filter((h) => !headerMap.has(h));
    if (missing.length > 0) {
      return NextResponse.json({ success: false, error: `模板缺少列: ${missing.join(', ')}` }, { status: 400 });
    }

    const rows: ImportRow[] = [];
    const rowErrors: string[] = [];
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
      const err = validateRequired(payload);
      if (err) {
        rowErrors.push(`第${rowNo}行: ${err}`);
        continue;
      }
      rows.push({ rowNo, payload });
    }

    if (rowErrors.length > 0) {
      return NextResponse.json({ success: false, error: 'Excel校验失败', details: rowErrors.slice(0, 200) }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: '没有可导入的数据行' }, { status: 400 });
    }

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());
    let createdCount = 0;
    let updatedCount = 0;
    const failedRows: string[] = [];

    for (const row of rows) {
      const payload = row.payload;
      try {
        const targetId = await resolveCustomerUpsertTargetId(ownerId, {
          orderName: payload.orderName!,
          phone: payload.phone!,
          companyName: showExtended ? payload.companyName || null : null,
        });

        if (targetId) {
          await assertNoCustomerScopeConflict(
            ownerId,
            {
              orderName: payload.orderName!,
              phone: payload.phone!,
              companyName: showExtended ? payload.companyName || null : null,
            },
            targetId
          );

          await db.customer.update({
            where: { id: targetId },
            data: {
              mark: payload.mark!,
              orderName: payload.orderName!,
              name: payload.name!,
              phone: payload.phone!,
              city: payload.city!,
              consignee: payload.consignee || null,
              ownerId,
              ...(showExtended
                ? {
                    companyName: payload.companyName || null,
                    companyAddress: payload.companyAddress || null,
                    credit: payload.credit ?? null,
                  }
                : {}),
            },
          });
          updatedCount++;
          continue;
        }

        await assertNoCustomerScopeConflict(ownerId, {
          orderName: payload.orderName!,
          phone: payload.phone!,
          companyName: showExtended ? payload.companyName || null : null,
        });

        await db.customer.create({
          data: {
            mark: payload.mark!,
            orderName: payload.orderName!,
            name: payload.name!,
            phone: payload.phone!,
            city: payload.city!,
            consignee: payload.consignee || null,
            companyName: showExtended ? payload.companyName || null : null,
            companyAddress: showExtended ? payload.companyAddress || null : null,
            credit: showExtended ? payload.credit ?? null : null,
            createdBy: currentUser.id,
            ownerId,
          },
        });
        createdCount++;
      } catch (error) {
        failedRows.push(`第${row.rowNo}行(NAME=${payload.name || '-'})：${mapPrismaWriteError(error)}`);
      }
    }

    const totalSuccess = createdCount + updatedCount;
    if (totalSuccess === 0) {
      return NextResponse.json(
        { success: false, error: '导入失败：所有行均未成功', details: failedRows.slice(0, 200) },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `导入完成：新增 ${createdCount}，更新 ${updatedCount}，失败 ${failedRows.length}`,
      data: {
        createdCount,
        updatedCount,
        failedCount: failedRows.length,
        failedRows: failedRows.slice(0, 200),
      },
    });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = trimStr(body.action);

  if (action === 'create') {
    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    let ownerId: string;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || null);
      await assertNoCustomerScopeConflict(ownerId, {
        orderName: payload.orderName!,
        phone: payload.phone!,
        companyName: showExtended ? payload.companyName || null : null,
      });
    } catch (innerError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(innerError) }, { status: 400 });
    }

    try {
      const created = await db.customer.create({
        data: {
          mark: payload.mark!,
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          companyName: showExtended ? payload.companyName : null,
          companyAddress: showExtended ? payload.companyAddress : null,
          credit: showExtended ? payload.credit : null,
          createdBy: currentUser.id,
          ownerId,
        },
      });

      if (currentUser.role === UserRole.ADMIN) {
        return NextResponse.json({ success: true, data: created });
      }
      return NextResponse.json({ success: true, data: toSalesView(created as Record<string, unknown>, showExtended) });
    } catch (createError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(createError) }, { status: 400 });
    }
  }

  if (action === 'update') {
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    const existing = await db.customer.findUnique({
      where: { id },
      select: { id: true, ownerId: true },
    });
    if (!existing) {
      return NextResponse.json({ success: false, error: '客户不存在' }, { status: 404 });
    }
    if (!canMutateCustomer(currentUser, existing.ownerId)) {
      return NextResponse.json({ success: false, error: '无权修改该客户' }, { status: 403 });
    }

    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    let ownerId = existing.ownerId;
    try {
      ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || existing.ownerId);
      await assertNoCustomerScopeConflict(
        ownerId,
        {
          orderName: payload.orderName!,
          phone: payload.phone!,
          companyName: showExtended ? payload.companyName || null : null,
        },
        id
      );
    } catch (innerError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(innerError) }, { status: 400 });
    }

    try {
      const updated = await db.customer.update({
        where: { id },
        data: {
          mark: payload.mark!,
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          ownerId,
          ...(showExtended
            ? {
                companyName: payload.companyName,
                companyAddress: payload.companyAddress,
                credit: payload.credit,
              }
            : {}),
        },
      });

      if (currentUser.role === UserRole.ADMIN) {
        return NextResponse.json({ success: true, data: updated });
      }
      return NextResponse.json({ success: true, data: toSalesView(updated as Record<string, unknown>, showExtended) });
    } catch (updateError) {
      return NextResponse.json({ success: false, error: mapPrismaWriteError(updateError) }, { status: 400 });
    }
  }

  if (action === 'delete') {
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可删除客户' }, { status: 403 });
    }
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    const existing = await db.customer.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ success: false, error: '客户不存在' }, { status: 404 });
    }

    await db.customer.delete({ where: { id } });
    return NextResponse.json({ success: true, message: '客户已删除' });
  }

  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
});
