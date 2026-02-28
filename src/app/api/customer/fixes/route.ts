import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { withAuth } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';
import { deriveOrderGroupKey } from '@/lib/order-group';

function trimStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function managerOnly(role: UserRole): NextResponse | null {
  if (role === UserRole.ADMIN || role === UserRole.SALES) return null;
  return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
}

async function salesCanEditExtended(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

type FixCustomerPayload = {
  mark: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string | null;
  companyAddress: string | null;
  credit: number | null;
};

function parsePayload(body: Record<string, unknown>): FixCustomerPayload | { error: string } {
  const mark = trimStr(body.mark);
  const name = trimStr(body.name);
  const phone = trimStr(body.phone);
  const city = trimStr(body.city);
  const consignee = trimStr(body.consignee);
  const companyName = trimStr(body.companyName) || null;
  const companyAddress = trimStr(body.companyAddress) || null;
  const creditRaw = body.credit;
  const credit = creditRaw === null || creditRaw === undefined || creditRaw === '' ? null : Number(creditRaw);

  if (!mark || !name || !phone || !city || !consignee) {
    return { error: 'MARK/NAME/PHONE/CITY/CONSIGNEE均为必填' };
  }
  if (credit !== null && (!Number.isFinite(credit) || credit <= 0)) {
    return { error: 'CREDIT必须为正数' };
  }

  return { mark, name, phone, city, consignee, companyName, companyAddress, credit };
}

async function upsertCustomer(currentUserId: string, role: UserRole, payload: FixCustomerPayload) {
  const existing = await db.customer.findFirst({
    where: {
      mark: { equals: payload.mark, mode: 'insensitive' },
      name: { equals: payload.name, mode: 'insensitive' },
    },
  });

  const allowExtended = role === UserRole.ADMIN || (await salesCanEditExtended());

  if (!existing) {
    return db.customer.create({
      data: {
        mark: payload.mark,
        name: payload.name,
        phone: payload.phone,
        city: payload.city,
        consignee: payload.consignee,
        companyName: allowExtended ? payload.companyName : null,
        companyAddress: allowExtended ? payload.companyAddress : null,
        credit: allowExtended ? payload.credit : null,
        createdBy: currentUserId,
      },
    });
  }

  return db.customer.update({
    where: { id: existing.id },
    data: {
      phone: payload.phone,
      city: payload.city,
      consignee: payload.consignee,
      ...(allowExtended
        ? {
            companyName: payload.companyName,
            companyAddress: payload.companyAddress,
            credit: payload.credit,
          }
        : {}),
    },
  });
}

async function syncSameGroupCustomer(
  baseOrderNo: string | null | undefined,
  customer: { id: string; mark: string; name: string; phone: string; city: string }
) {
  const groupKey = deriveOrderGroupKey(baseOrderNo);
  if (!groupKey) return 0;

  const allOrders = await db.order.findMany({
    select: { id: true, orderNo: true },
  });
  const targetOrderIds = allOrders
    .filter((row) => deriveOrderGroupKey(row.orderNo) === groupKey)
    .map((row) => row.id);
  if (targetOrderIds.length === 0) return 0;

  const orderUpdated = await db.order.updateMany({
    where: { id: { in: targetOrderIds } },
    data: {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
    },
  });
  const receiptUpdatedByOrder = await db.receipt.updateMany({
    where: { orderId: { in: targetOrderIds } },
    data: {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
    },
  });
  const receiptCandidates = await db.receipt.findMany({
    where: {
      orderNo: { not: null },
    },
    select: { id: true, orderNo: true },
  });
  const receiptIdsByGroup = receiptCandidates
    .filter((row) => deriveOrderGroupKey(row.orderNo) === groupKey)
    .map((row) => row.id);
  const receiptUpdatedByOrderNo = receiptIdsByGroup.length
    ? await db.receipt.updateMany({
        where: { id: { in: receiptIdsByGroup } },
        data: {
          customerId: customer.id,
          customerMark: customer.mark,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerCity: customer.city,
          needsCustomerFix: false,
        },
      })
    : { count: 0 };

  return orderUpdated.count + receiptUpdatedByOrder.count + receiptUpdatedByOrderNo.count;
}

export const GET = withAuth(async (_request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const [orders, receipts] = await Promise.all([
    db.order.findMany({
      where: { needsCustomerFix: true },
      include: {
        invoice: { select: { id: true, invNo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.receipt.findMany({
      where: { needsCustomerFix: true },
      select: {
        id: true,
        receiptNo: true,
        usd: true,
        status: true,
        orderNo: true,
        invNo: true,
        customerMark: true,
        customerName: true,
        customerPhone: true,
        customerCity: true,
        createdAt: true,
        orderId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  return NextResponse.json({ success: true, data: { orders, receipts } });
});

export const POST = withAuth(async (request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = trimStr(body.action);

  if (action !== 'resolve-order' && action !== 'resolve-receipt') {
    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  }

  const parsed = parsePayload(body);
  if ('error' in parsed) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  const customer = await upsertCustomer(currentUser.id, currentUser.role as UserRole, parsed);

  if (action === 'resolve-order') {
    const orderId = trimStr(body.orderId);
    if (!orderId) return NextResponse.json({ success: false, error: 'orderId不能为空' }, { status: 400 });

    const order = await db.order.update({
      where: { id: orderId },
      data: {
        customerId: customer.id,
        customerMark: customer.mark,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerCity: customer.city,
        needsCustomerFix: false,
      },
      select: { orderNo: true },
    });

    await syncSameGroupCustomer(order.orderNo, customer);

    return NextResponse.json({ success: true, message: '订单客户信息已修复', data: customer });
  }

  const receiptId = trimStr(body.receiptId);
  if (!receiptId) return NextResponse.json({ success: false, error: 'receiptId不能为空' }, { status: 400 });

  const receipt = await db.receipt.update({
    where: { id: receiptId },
    data: {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
    },
    select: { orderId: true, orderNo: true },
  });

  if (receipt.orderId) {
    await db.order.update({
      where: { id: receipt.orderId },
      data: {
        customerId: customer.id,
        customerMark: customer.mark,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerCity: customer.city,
        needsCustomerFix: false,
      },
    });
  }

  await syncSameGroupCustomer(receipt.orderNo, customer);

  return NextResponse.json({ success: true, message: '收据客户信息已修复', data: customer });
});
