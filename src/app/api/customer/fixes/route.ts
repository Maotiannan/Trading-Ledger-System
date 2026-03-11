import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { apiErrorCodes } from '@/lib/api-error';
import { createApiErrorResponse, toApiErrorResponse } from '@/lib/api-error-response';
import { createApiSuccessResponse } from '@/lib/api-success-response';
import { withAuth } from '@/lib/route-auth';
import { getSystemSettings } from '@/lib/system-settings';
import { deriveOrderGroupKey } from '@/lib/order-group';
import {
  assertNoCustomerScopeConflict,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
  resolveCustomerUpsertTargetId,
} from '@/lib/customer-scope';

function trimStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function managerOnly(role: UserRole, request?: NextRequest): NextResponse | null {
  if (role === UserRole.ADMIN || role === UserRole.SALES) return null;
  return createApiErrorResponse({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' }, request);
}

async function salesCanEditExtended(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

type FixCustomerPayload = {
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string | null;
  companyName: string | null;
  companyAddress: string | null;
  credit: number | null;
};

function parsePayload(body: Record<string, unknown>): FixCustomerPayload | { error: string } {
  const mark = trimStr(body.mark);
  const orderName = trimStr(body.orderName);
  const name = trimStr(body.name);
  const phone = trimStr(body.phone);
  const city = trimStr(body.city);
  const consignee = trimStr(body.consignee) || null;
  const companyName = trimStr(body.companyName) || null;
  const companyAddress = trimStr(body.companyAddress) || null;
  const creditRaw = body.credit;
  const credit = creditRaw === null || creditRaw === undefined || creditRaw === '' ? null : Number(creditRaw);

  if (!mark || !orderName || !name || !phone || !city) {
    return { error: 'MARK/ORDER_NAME/NAME/PHONE/CITY均为必填' };
  }
  if (credit !== null && (!Number.isFinite(credit) || credit < 0)) {
    return { error: 'CREDIT必须为大于等于0的数字' };
  }

  return { mark, orderName, name, phone, city, consignee, companyName, companyAddress, credit };
}

async function upsertCustomer(currentUserId: string, role: UserRole, payload: FixCustomerPayload, ownerId: string) {
  const allowExtended = role === UserRole.ADMIN || (await salesCanEditExtended());
  const scopedCompanyName = allowExtended ? payload.companyName : null;

  const targetId = await resolveCustomerUpsertTargetId(ownerId, {
    orderName: payload.orderName,
    phone: payload.phone,
    companyName: scopedCompanyName,
  });

  if (targetId) {
    await assertNoCustomerScopeConflict(
      ownerId,
      {
        orderName: payload.orderName,
        phone: payload.phone,
        companyName: scopedCompanyName,
      },
      targetId
    );
    return db.customer.update({
      where: { id: targetId },
      data: {
        mark: payload.mark,
        orderName: payload.orderName,
        name: payload.name,
        phone: payload.phone,
        city: payload.city,
        consignee: payload.consignee,
        ownerId,
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

  await assertNoCustomerScopeConflict(ownerId, {
    orderName: payload.orderName,
    phone: payload.phone,
    companyName: scopedCompanyName,
  });
  return db.customer.create({
    data: {
      mark: payload.mark,
      orderName: payload.orderName,
      name: payload.name,
      phone: payload.phone,
      city: payload.city,
      consignee: payload.consignee,
      companyName: allowExtended ? payload.companyName : null,
      companyAddress: allowExtended ? payload.companyAddress : null,
      credit: allowExtended ? payload.credit : null,
      createdBy: currentUserId,
      ownerId,
    },
  });
}

async function syncSameGroupCustomer(
  baseOrderNo: string | null | undefined,
  customer: { id: string; mark: string; name: string; orderName: string; phone: string; city: string },
  ownerId?: string
) {
  const groupKey = deriveOrderGroupKey(baseOrderNo);
  if (!groupKey) return 0;

  const allOrders = await db.order.findMany({
    where: ownerId ? { createdBy: ownerId } : undefined,
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
      customerName: customer.orderName,
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
      customerName: customer.orderName,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
    },
  });
  const receiptCandidates = await db.receipt.findMany({
    where: {
      orderNo: { not: null },
      ...(ownerId ? { createdBy: ownerId } : {}),
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
          customerName: customer.orderName,
          customerPhone: customer.phone,
          customerCity: customer.city,
          needsCustomerFix: false,
        },
      })
    : { count: 0 };

  return orderUpdated.count + receiptUpdatedByOrder.count + receiptUpdatedByOrderNo.count;
}

export const GET = withAuth(async (_request: NextRequest, currentUser) => {
  const denied = managerOnly(currentUser.role as UserRole, _request);
  if (denied) return denied;

  const [orders, receipts] = await Promise.all([
    db.order.findMany({
      where: {
        needsCustomerFix: true,
        ...(currentUser.role === UserRole.SALES ? { createdBy: currentUser.id } : {}),
      },
      include: {
        invoice: { select: { id: true, invNo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    db.receipt.findMany({
      where: {
        needsCustomerFix: true,
        ...(currentUser.role === UserRole.SALES ? { createdBy: currentUser.id } : {}),
      },
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
  const denied = managerOnly(currentUser.role as UserRole, request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = trimStr(body.action);

  if (action !== 'resolve-order' && action !== 'resolve-receipt') {
    return createApiErrorResponse({
      code: apiErrorCodes.INVALID_ACTION,
      status: 400,
      message: '未知操作',
      detail: { action },
    }, request);
  }

  const parsed = parsePayload(body);
  if ('error' in parsed) {
    return createApiErrorResponse({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: parsed.error }, request);
  }

  let ownerId: string;
  try {
    ownerId = await resolveCustomerOwnerId(currentUser, trimStr(body.ownerId) || null);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: mapPrismaWriteError(error),
    }, request);
  }

  let customer;
  try {
    customer = await upsertCustomer(currentUser.id, currentUser.role as UserRole, parsed, ownerId);
  } catch (error) {
    return toApiErrorResponse(error, {
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: mapPrismaWriteError(error),
    }, request);
  }

  if (action === 'resolve-order') {
    const orderId = trimStr(body.orderId);
    if (!orderId) return createApiErrorResponse({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'orderId不能为空' }, request);

    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, createdBy: true },
    });
    if (!existingOrder) return createApiErrorResponse({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '订单不存在' }, request);
    if (currentUser.role === UserRole.SALES && existingOrder.createdBy !== currentUser.id) {
      return createApiErrorResponse({ code: apiErrorCodes.CUSTOMER_SCOPE_FORBIDDEN, status: 403, message: '无权修复该订单' }, request);
    }

    const order = await db.order.update({
      where: { id: orderId },
      data: {
        customerId: customer.id,
        customerMark: customer.mark,
        customerName: customer.orderName,
        customerPhone: customer.phone,
        customerCity: customer.city,
        needsCustomerFix: false,
      },
      select: { orderNo: true },
    });

    await syncSameGroupCustomer(order.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);

    return createApiSuccessResponse({ message: '订单客户信息已修复', data: customer }, request);
  }

  const receiptId = trimStr(body.receiptId);
  if (!receiptId) return createApiErrorResponse({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'receiptId不能为空' }, request);

  const existingReceipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, createdBy: true },
  });
  if (!existingReceipt) return createApiErrorResponse({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '收据不存在' }, request);
  if (currentUser.role === UserRole.SALES && existingReceipt.createdBy !== currentUser.id) {
    return createApiErrorResponse({ code: apiErrorCodes.CUSTOMER_SCOPE_FORBIDDEN, status: 403, message: '无权修复该收据' }, request);
  }

  const receipt = await db.receipt.update({
    where: { id: receiptId },
    data: {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.orderName,
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
        customerName: customer.orderName,
        customerPhone: customer.phone,
        customerCity: customer.city,
        needsCustomerFix: false,
      },
    });
  }

  await syncSameGroupCustomer(receipt.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);

  return createApiSuccessResponse({ message: '收据客户信息已修复', data: customer }, request);
});
