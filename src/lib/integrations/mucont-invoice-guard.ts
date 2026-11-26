import type { DbTransactionClient } from '@/lib/transaction';
import { createApiError } from '@/lib/api-error';

export async function assertUnlinkedInvoice(tx: DbTransactionClient, invoiceId: string) {
  const source = await tx.mucontInvoiceSource.findUnique({ where: { invoiceId } });
  if (source) throw createApiError({ code: 'CONFLICT', status: 409,
    message: 'MuCont source invoice: use local order editing or resync; structural changes and date edits are not allowed here.' });
}
export async function assertUnlinkedOrders(tx: DbTransactionClient, orderIds: string[]) {
  const source = await tx.mucontInvoiceGroup.findFirst({ where: { orderId: { in: orderIds } } });
  if (source) throw createApiError({ code: 'CONFLICT', status: 409,
    message: 'MuCont source groups cannot be moved, merged, deleted or incremented by import.' });
}
