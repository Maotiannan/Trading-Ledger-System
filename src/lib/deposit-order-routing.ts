import { Prisma } from '@prisma/client';
import { ensureDepositPoolInvoice } from '@/lib/matching';
import { lockOrderBalances } from '@/lib/order-balance-lock';
import { recordAuditEventInTransaction } from '@/lib/audit';

export async function promoteUnassociatedDepositOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string,
): Promise<boolean> {
  await lockOrderBalances(tx, [orderId]);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true, invoiceId: true, invoice: { select: { invNo: true } }, amount: true, canceledAt: true, paymentAllocationMode: true, createdBy: true },
  });
  // Never detach a real invoice, canceled order or nonzero receivable.
  if (!order || order.canceledAt || order.paymentAllocationMode || order.invoice.invNo !== 'Un_Associated' || !new Prisma.Decimal(order.amount).isZero()) return false;
  const invoiceId = await ensureDepositPoolInvoice(order.createdBy || actorId, tx);
  await tx.order.update({ where: { id: orderId }, data: { invoiceId } });
  await recordAuditEventInTransaction(tx, {
    action: 'ORDER_DEPOSIT_POOL_ASSIGN', actorId, targetType: 'Order', targetId: orderId,
    metadata: { orderNo: order.orderNo, source: 'deposit-receipt', before: { invoiceId: order.invoiceId }, after: { invoiceId } },
  });
  return true;
}
