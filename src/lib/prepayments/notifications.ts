import type { DbTransactionClient } from '@/lib/transaction';
import { refreshReceiptNotificationInTransaction } from '@/lib/email/email-notification-projector';

// Allocation is not new income. Refresh existing unsent receipt snapshots only;
// do not create a receipt event or modify an already-sent customer statement.
export async function refreshPendingPaymentNotifications(tx: DbTransactionClient, orderIds: string[], actorId: string) {
  const pending = await tx.emailNotification.findMany({ where: { status: { in: ['PENDING', 'MISSING_RECIPIENT'] },
    receipt: { orderId: { in: [...new Set(orderIds)] } } }, select: { receiptId: true } });
  for (const row of pending) if (row.receiptId) await refreshReceiptNotificationInTransaction(tx, { receiptId: row.receiptId, actorId });
}
