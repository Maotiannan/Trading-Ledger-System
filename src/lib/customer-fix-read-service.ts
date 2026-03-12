import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

export async function listCustomerFixQueue(currentUser: CurrentUser) {
  ensureManager(currentUser);

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

  await recordAuditEvent({
    action: auditActions.CUSTOMER_FIX_QUEUE_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      orderCount: orders.length,
      receiptCount: receipts.length,
      currentRole: currentUser.role,
    },
  });

  return {
    data: { orders, receipts },
    message: `客户修复队列已加载：订单 ${orders.length} 条，收据 ${receipts.length} 条`,
  };
}
