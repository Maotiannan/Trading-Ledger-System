import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { resolveCustomer } from '@/lib/customer-matching';

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

function fixOwnerIds(currentUser: CurrentUser, createdBy: unknown): string[] | null {
  if (currentUser.role === UserRole.SALES) return [currentUser.id];
  const ownerId = typeof createdBy === 'string' && createdBy.trim() ? createdBy.trim() : '';
  return ownerId ? Array.from(new Set([ownerId, currentUser.id])) : null;
}

async function repairResolvableCustomerFixes(
  currentUser: CurrentUser,
  orders: Array<Record<string, unknown>>,
  receipts: Array<Record<string, unknown>>,
): Promise<number> {
  let repaired = 0;

  for (const order of orders) {
    const resolved = await resolveCustomer({
      customerMark: String(order.customerMark || ''),
      customerOrderName: String(order.customerName || ''),
      customerId: typeof order.customerId === 'string' ? order.customerId : null,
      customerOrderNo: String(order.orderNo || ''),
      ownerIds: fixOwnerIds(currentUser, order.createdBy),
    });
    if (!resolved.customerId || resolved.needsCustomerFix) continue;
    await db.order.update({
      where: { id: String(order.id) },
      data: {
        customerId: resolved.customerId,
        customerMark: resolved.customerMark,
        customerName: resolved.customerName,
        customerPhone: resolved.customerPhone,
        customerCity: resolved.customerCity,
        needsCustomerFix: false,
      },
    });
    repaired += 1;
  }

  for (const receipt of receipts) {
    const resolved = await resolveCustomer({
      customerMark: String(receipt.customerMark || ''),
      customerOrderName: String(receipt.customerName || ''),
      customerId: typeof receipt.customerId === 'string' ? receipt.customerId : null,
      customerOrderNo: String(receipt.orderNo || ''),
      ownerIds: fixOwnerIds(currentUser, receipt.createdBy),
    });
    if (!resolved.customerId || resolved.needsCustomerFix) continue;
    await db.receipt.update({
      where: { id: String(receipt.id) },
      data: {
        customerId: resolved.customerId,
        customerMark: resolved.customerMark,
        customerName: resolved.customerName,
        customerPhone: resolved.customerPhone,
        customerCity: resolved.customerCity,
        needsCustomerFix: false,
      },
    });
    repaired += 1;
  }

  return repaired;
}

export async function listCustomerFixQueue(currentUser: CurrentUser) {
  ensureManager(currentUser);

  const buildOrderQuery = () => db.order.findMany({
    where: {
      needsCustomerFix: true,
      ...(currentUser.role === UserRole.SALES ? { createdBy: currentUser.id } : {}),
    },
    include: {
      invoice: { select: { id: true, invNo: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const buildReceiptQuery = () => db.receipt.findMany({
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
      customerId: true,
      customerMark: true,
      customerName: true,
      customerPhone: true,
      customerCity: true,
      createdAt: true,
      createdBy: true,
      orderId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  let [orders, receipts] = await Promise.all([
    buildOrderQuery(),
    buildReceiptQuery(),
  ]);

  const repairedCount = await repairResolvableCustomerFixes(
    currentUser,
    orders as Array<Record<string, unknown>>,
    receipts as Array<Record<string, unknown>>,
  );
  if (repairedCount > 0) {
    [orders, receipts] = await Promise.all([
      buildOrderQuery(),
      buildReceiptQuery(),
    ]);
  }

  await recordAuditEvent({
    action: auditActions.CUSTOMER_FIX_QUEUE_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      orderCount: orders.length,
      receiptCount: receipts.length,
      repairedCount,
      currentRole: currentUser.role,
    },
  });

  return {
    data: { orders, receipts },
    message: `客户修复队列已加载：订单 ${orders.length} 条，收据 ${receipts.length} 条`,
  };
}
