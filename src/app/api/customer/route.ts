import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';

type CustomerPayload = {
  mark?: string;
  orderName?: string;
  name?: string;
  phone?: string;
  city?: string;
  consignee?: string;
  companyName?: string | null;
  credit?: number | null;
  companyAddress?: string | null;
};

function trimStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    consignee: trimStr(body.consignee),
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
  if (!payload.consignee) return 'CONSIGNEE不能为空';
  if (payload.credit !== null && payload.credit !== undefined) {
    if (!Number.isFinite(payload.credit) || payload.credit <= 0) return 'CREDIT必须为正数';
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
  const mark = trimStr(searchParams.get('mark'));
  const search = trimStr(searchParams.get('search'));

  const where: Record<string, unknown> = {};
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
  return NextResponse.json({ success: true, data: rows.map((row) => toSalesView(row, showExtended)) });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = trimStr(body.action);

  if (action === 'create') {
    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    const created = await db.customer.create({
      data: {
        mark: payload.mark!,
        orderName: payload.orderName!,
        name: payload.name!,
        phone: payload.phone!,
        city: payload.city!,
        consignee: payload.consignee!,
        companyName: showExtended ? payload.companyName : null,
        companyAddress: showExtended ? payload.companyAddress : null,
        credit: showExtended ? payload.credit : null,
        createdBy: currentUser.id,
      },
    });

    if (currentUser.role === UserRole.ADMIN) {
      return NextResponse.json({ success: true, data: created });
    }
    return NextResponse.json({ success: true, data: toSalesView(created as Record<string, unknown>, showExtended) });
  }

  if (action === 'update') {
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    const payload = parsePayload(body);
    const error = validateRequired(payload);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedFields());

    const updated = await db.customer.update({
      where: { id },
      data: {
        mark: payload.mark!,
        orderName: payload.orderName!,
        name: payload.name!,
        phone: payload.phone!,
        city: payload.city!,
        consignee: payload.consignee!,
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
  }

  if (action === 'delete') {
    if (currentUser.role !== UserRole.ADMIN) {
      return NextResponse.json({ success: false, error: '只有管理员可删除客户' }, { status: 403 });
    }
    const id = trimStr(body.id);
    if (!id) return NextResponse.json({ success: false, error: '客户ID不能为空' }, { status: 400 });

    await db.customer.delete({ where: { id } });
    return NextResponse.json({ success: true, message: '客户已删除' });
  }

  return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
});
