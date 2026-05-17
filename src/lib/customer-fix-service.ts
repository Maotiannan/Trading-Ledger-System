import { UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { deriveOrderGroupKey } from '@/lib/order-group';
import type { CurrentUser } from '@/lib/request-auth';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  customerAccessWhere,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
  resolveCustomerUpsertTargetId,
} from '@/lib/customer-scope';
import { syncCustomerOrderNames } from '@/lib/customer-order-name-service';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

export type FixCustomerPayload = {
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

function trimStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMarkForMatch(value: string | null | undefined): string {
  return trimStr(value).replace(/\s+/g, ' ').toLowerCase();
}

export function parseFixCustomerPayload(body: Record<string, unknown>): FixCustomerPayload | { error: string } {
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

async function salesCanEditExtended(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

async function upsertCustomer(
  tx: DbTransactionClient,
  currentUserId: string,
  role: UserRole,
  payload: FixCustomerPayload,
  ownerId: string,
) {
  const allowExtended = role === UserRole.ADMIN || (await salesCanEditExtended());
  const scopedCompanyName = allowExtended ? payload.companyName : null;

  const targetId = await resolveCustomerUpsertTargetId(ownerId, {
    orderName: payload.orderName,
    phone: payload.phone,
    companyName: scopedCompanyName,
  }, tx);

  if (targetId) {
    await assertNoCustomerScopeConflict(
      ownerId,
      {
        orderName: payload.orderName,
        phone: payload.phone,
        companyName: scopedCompanyName,
      },
      targetId,
      tx,
    );
    const updated = await tx.customer.update({
      where: { id: targetId },
      data: {
        mark: payload.mark,
        normalizedMark: normalizeMarkForMatch(payload.mark),
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
    await syncCustomerOrderNames(tx as unknown as Parameters<typeof syncCustomerOrderNames>[0], updated.id, payload.orderName);
    return updated;
  }

  await assertNoCustomerScopeConflict(ownerId, {
    orderName: payload.orderName,
    phone: payload.phone,
    companyName: scopedCompanyName,
  }, undefined, tx);
  const created = await tx.customer.create({
    data: {
      mark: payload.mark,
      normalizedMark: normalizeMarkForMatch(payload.mark),
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
  await syncCustomerOrderNames(tx as unknown as Parameters<typeof syncCustomerOrderNames>[0], created.id, payload.orderName);
  return created;
}

async function syncSameGroupCustomer(
  tx: DbTransactionClient,
  baseOrderNo: string | null | undefined,
  customer: { id: string; mark: string; name: string; orderName: string; phone: string; city: string },
  ownerId?: string,
) {
  const groupKey = deriveOrderGroupKey(baseOrderNo);
  if (!groupKey) return 0;

  const allOrders = await tx.order.findMany({
    where: ownerId ? { createdBy: ownerId } : undefined,
    select: { id: true, orderNo: true },
  });
  const targetOrderIds = allOrders
    .filter((row) => deriveOrderGroupKey(row.orderNo) === groupKey)
    .map((row) => row.id);
  if (targetOrderIds.length === 0) return 0;

  const orderUpdated = await tx.order.updateMany({
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
  const receiptUpdatedByOrder = await tx.receipt.updateMany({
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
  const receiptCandidates = await tx.receipt.findMany({
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
    ? await tx.receipt.updateMany({
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

type ExistingCustomerForFix = {
  id: string;
  mark: string;
  name: string;
  orderName: string;
  phone: string;
  city: string;
  ownerId: string;
};

function customerFixData(customer: ExistingCustomerForFix) {
  return {
    customerId: customer.id,
    customerMark: customer.mark,
    customerName: customer.orderName,
    customerPhone: customer.phone,
    customerCity: customer.city,
    needsCustomerFix: false,
  };
}

function toApiError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
    throw error;
  }
  throw createApiError({
    code: 'BAD_REQUEST',
    status: 400,
    message: mapPrismaWriteError(error) || fallback,
  });
}

function assertManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

async function findVisibleExistingCustomer(
  tx: DbTransactionClient,
  currentUser: CurrentUser,
  customerId: string,
): Promise<ExistingCustomerForFix> {
  const customer = await tx.customer.findFirst({
    where: {
      AND: [
        { id: customerId },
        customerAccessWhere(currentUser),
      ],
    },
    select: {
      id: true,
      mark: true,
      name: true,
      orderName: true,
      phone: true,
      city: true,
      ownerId: true,
    },
  });
  if (!customer) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '客户不存在或无权限' });
  }
  return customer;
}

export async function resolveOrderCustomerFix(
  currentUser: CurrentUser,
  input: { orderId: string; ownerId?: string | null; payload: FixCustomerPayload },
) {
  assertManager(currentUser);
  const orderId = trimStr(input.orderId);
  if (!orderId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: 'orderId不能为空' });
  }

  const existingOrder = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, createdBy: true, orderNo: true },
  });
  if (!existingOrder) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '订单不存在' });
  }
  if (currentUser.role === UserRole.SALES && existingOrder.createdBy !== currentUser.id) {
    throw createApiError({ code: 'CUSTOMER_SCOPE_FORBIDDEN', status: 403, message: '无权修复该订单' });
  }

  try {
    const ownerId = await resolveCustomerOwnerId(currentUser, input.ownerId || null);
    const result = await runInTransaction(async (tx) => {
      const customer = await upsertCustomer(tx, currentUser.id, currentUser.role, input.payload, ownerId);
      const order = await tx.order.update({
        where: { id: orderId },
        data: customerFixData(customer),
        select: { orderNo: true },
      });
      const syncedCount = await syncSameGroupCustomer(tx, order.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);
      return { customer, syncedCount };
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_FIX_ORDER,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      targetId: orderId,
      metadata: {
        customerId: result.customer.id,
        ownerId,
        syncedCount: result.syncedCount,
      },
    });

    return { data: result.customer, message: '订单客户信息已修复' };
  } catch (error) {
    toApiError(error, '订单客户信息修复失败');
    throw error;
  }
}

export async function resolveReceiptCustomerFix(
  currentUser: CurrentUser,
  input: { receiptId: string; ownerId?: string | null; payload: FixCustomerPayload },
) {
  assertManager(currentUser);
  const receiptId = trimStr(input.receiptId);
  if (!receiptId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: 'receiptId不能为空' });
  }

  const existingReceipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, createdBy: true, orderId: true, orderNo: true },
  });
  if (!existingReceipt) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '收据不存在' });
  }
  if (currentUser.role === UserRole.SALES && existingReceipt.createdBy !== currentUser.id) {
    throw createApiError({ code: 'CUSTOMER_SCOPE_FORBIDDEN', status: 403, message: '无权修复该收据' });
  }

  try {
    const ownerId = await resolveCustomerOwnerId(currentUser, input.ownerId || null);
    const result = await runInTransaction(async (tx) => {
      const customer = await upsertCustomer(tx, currentUser.id, currentUser.role, input.payload, ownerId);
      const receipt = await tx.receipt.update({
        where: { id: receiptId },
        data: customerFixData(customer),
        select: { orderId: true, orderNo: true },
      });

      if (receipt.orderId) {
        await tx.order.update({
          where: { id: receipt.orderId },
          data: customerFixData(customer),
        });
      }

      const syncedCount = await syncSameGroupCustomer(tx, receipt.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);
      return { customer, syncedCount };
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_FIX_RECEIPT,
      actorId: currentUser.id,
      targetType: auditTargetTypes.RECEIPT,
      targetId: receiptId,
      metadata: {
        customerId: result.customer.id,
        ownerId,
        syncedCount: result.syncedCount,
      },
    });

    return { data: result.customer, message: '收据客户信息已修复' };
  } catch (error) {
    toApiError(error, '收据客户信息修复失败');
    throw error;
  }
}

export async function linkOrderCustomerFix(
  currentUser: CurrentUser,
  input: { orderId: string; customerId: string },
) {
  assertManager(currentUser);
  const orderId = trimStr(input.orderId);
  const customerId = trimStr(input.customerId);
  if (!orderId || !customerId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: 'orderId/customerId不能为空' });
  }

  const existingOrder = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, createdBy: true, orderNo: true },
  });
  if (!existingOrder) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '订单不存在' });
  }
  if (currentUser.role === UserRole.SALES && existingOrder.createdBy !== currentUser.id) {
    throw createApiError({ code: 'CUSTOMER_SCOPE_FORBIDDEN', status: 403, message: '无权修复该订单' });
  }

  try {
    const result = await runInTransaction(async (tx) => {
      const customer = await findVisibleExistingCustomer(tx, currentUser, customerId);
      const order = await tx.order.update({
        where: { id: orderId },
        data: customerFixData(customer),
        select: { orderNo: true },
      });
      const syncedCount = await syncSameGroupCustomer(tx, order.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);
      return { customer, syncedCount };
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_FIX_ORDER,
      actorId: currentUser.id,
      targetType: auditTargetTypes.ORDER,
      targetId: orderId,
      metadata: {
        customerId: result.customer.id,
        linkedExisting: true,
        syncedCount: result.syncedCount,
      },
    });

    return { data: result.customer, message: '订单已关联到已有客户' };
  } catch (error) {
    toApiError(error, '订单关联已有客户失败');
    throw error;
  }
}

export async function linkReceiptCustomerFix(
  currentUser: CurrentUser,
  input: { receiptId: string; customerId: string },
) {
  assertManager(currentUser);
  const receiptId = trimStr(input.receiptId);
  const customerId = trimStr(input.customerId);
  if (!receiptId || !customerId) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: 'receiptId/customerId不能为空' });
  }

  const existingReceipt = await db.receipt.findUnique({
    where: { id: receiptId },
    select: { id: true, createdBy: true, orderId: true, orderNo: true },
  });
  if (!existingReceipt) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '收据不存在' });
  }
  if (currentUser.role === UserRole.SALES && existingReceipt.createdBy !== currentUser.id) {
    throw createApiError({ code: 'CUSTOMER_SCOPE_FORBIDDEN', status: 403, message: '无权修复该收据' });
  }

  try {
    const result = await runInTransaction(async (tx) => {
      const customer = await findVisibleExistingCustomer(tx, currentUser, customerId);
      const receipt = await tx.receipt.update({
        where: { id: receiptId },
        data: customerFixData(customer),
        select: { orderId: true, orderNo: true },
      });

      if (receipt.orderId) {
        await tx.order.update({
          where: { id: receipt.orderId },
          data: customerFixData(customer),
        });
      }

      const syncedCount = await syncSameGroupCustomer(tx, receipt.orderNo, customer, currentUser.role === UserRole.SALES ? currentUser.id : undefined);
      return { customer, syncedCount };
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_FIX_RECEIPT,
      actorId: currentUser.id,
      targetType: auditTargetTypes.RECEIPT,
      targetId: receiptId,
      metadata: {
        customerId: result.customer.id,
        linkedExisting: true,
        syncedCount: result.syncedCount,
      },
    });

    return { data: result.customer, message: '收据已关联到已有客户' };
  } catch (error) {
    toApiError(error, '收据关联已有客户失败');
    throw error;
  }
}
