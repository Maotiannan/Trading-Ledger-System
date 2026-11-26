import { Prisma } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { updateOrderBalance } from '@/lib/order-balance-service';
import { conflict, type FinancialSnapshot } from './contract';
import { refreshPendingPaymentNotifications } from './notifications';
import { authorizeAllocationWrite } from './write-context';

type Snapshot = Pick<FinancialSnapshot, 'invoiceBatchId' | 'groupChanges'> & { customers: Array<{ billingGroupId: string }> };

export async function validateGroupChanges(tx: DbTransactionClient, snapshot: Snapshot) {
  const source = await tx.mucontInvoiceSource.findUnique({ where: { invoiceBatchId: snapshot.invoiceBatchId },
    select: { publicationSequence: true, groups: { select: { billingGroupId: true, orderId: true, customerId: true,
      order: { select: { canceledAt: true } } } } } });
  const removed = (source?.groups || []).filter(g => !g.order?.canceledAt && !snapshot.customers.some(c => c.billingGroupId === g.billingGroupId));
  const changes = snapshot.groupChanges;
  if (!changes) {
    if (removed.length) conflict('Removing a linked group requires an explicit versioned declaration.', 'INVOICE_REMOVAL_REQUIRED');
    return [];
  }
  if (!source || changes.expectedPublicationSequence !== source.publicationSequence) {
    conflict('Invoice publication changed. Refresh before removing groups.', 'INVOICE_REMOVAL_VERSION_CONFLICT');
  }
  if (removed.length !== changes.removedBillingGroupIds.length || removed.some(g => !changes.removedBillingGroupIds.includes(g.billingGroupId))) {
    conflict('Removed groups must match the current active invoice groups exactly.', 'INVOICE_REMOVAL_GROUP_CONFLICT');
  }
  if (Boolean(changes.cancelInvoice) !== (snapshot.customers.length === 0)) conflict('Full cancellation must have no remaining groups.');
  const ids = removed.map(g => g.orderId);
  if (await tx.balanceTransfer.count({ where: { OR: [{ fromOrderId: { in: ids } }, { toOrderId: { in: ids } }] } })) {
    conflict('Legacy transfer history requires explicit reconciliation; no synthetic receipt will become income.', 'PREPAYMENT_LEGACY_TRANSFER_CONFLICT');
  }
  return removed;
}

export async function cancelRemovedGroups(tx: DbTransactionClient, snapshot: FinancialSnapshot, actorId: string) {
  if (!snapshot.groupChanges) return;
  authorizeAllocationWrite(tx);
  const groups = await tx.mucontInvoiceGroup.findMany({ where: { invoiceBatchId: snapshot.invoiceBatchId,
    billingGroupId: { in: snapshot.groupChanges.removedBillingGroupIds } }, include: {
    order: { include: { receipts: { include: { funding: true, generatedByBalanceTransfer: true } } } },
  } });
  const canceledAt = new Date();
  for (const group of groups) {
    const order = group.order;
    if (order.canceledAt) continue;
    const released = await tx.prepaymentAllocation.findMany({ where: { orderId: order.id, state: { in: ['APPLIED', 'RESERVED'] } } });
    await tx.prepaymentAllocation.updateMany({ where: { id: { in: released.map(a => a.id) } }, data: { state: 'RELEASED', releasedAt: canceledAt } });
    const activated: string[] = [];
    for (const receipt of order.receipts) {
      if (receipt.funding || receipt.status === 'SIGNING_PENDING') continue;
      if (receipt.generatedByBalanceTransfer || receipt.receiptNo?.startsWith('TRANSFER-')) conflict('Synthetic transfer receipts cannot become new income.', 'PREPAYMENT_LEGACY_TRANSFER_CONFLICT');
      const source = await tx.prepaymentSource.findUnique({ where: { orderId: order.id } });
      const originPlan = await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: snapshot.invoiceBatchId, state: 'APPLIED' }, orderBy: { version: 'desc' } });
      const originGroup = (originPlan?.snapshot as FinancialSnapshot | undefined)?.customers.find(g => g.billingGroupId === group.billingGroupId);
      const originSourceIds = originGroup?.orderRefs.flatMap(ref => ref.binding?.type === 'LEDGER_SOURCE' ? [ref.binding.id] : []) || [];
      const funding = await tx.receiptFunding.create({ data: {
        receiptId: receipt.id, originalReceiptId: receipt.id, originalOrderId: order.id,
        originalCustomerId: group.customerId, receivedAmount: receipt.usd,
        receiptSnapshot: { receiptId: receipt.id, receiptNo: receipt.receiptNo, usd: receipt.usd.toFixed(2),
          orderId: order.id, customerId: group.customerId, createdAt: receipt.createdAt.toISOString(),
          createdBy: receipt.createdBy, originSourceIds, cancellationBatchId: snapshot.invoiceBatchId },
      } });
      await tx.prepaymentCredit.create({ data: { fundingId: funding.id, customerId: group.customerId, sourceId: source?.id,
        invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId, amount: receipt.usd } });
      activated.push(funding.id);
    }
    await tx.orderAlias.deleteMany({ where: { orderId: order.id } });
    await tx.order.update({ where: { id: order.id }, data: { amount: new Prisma.Decimal(0), canceledAt, paymentAllocationMode: true } });
    const balance = await updateOrderBalance(order.id, tx, { actorId, source: 'MUCONT_GROUP_CANCELED' });
    await refreshPendingPaymentNotifications(tx, [order.id], actorId);
    await recordAuditEventInTransaction(tx, { action: 'MUCONT_GROUP_CANCELED', actorId, targetType: 'ORDER', targetId: order.id,
      metadata: { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId,
        before: { amount: order.amount.toFixed(2), balance: order.orderBalance.toFixed(2) }, after: { amount: '0.00', balance: balance.computed },
        released: released.map(a => ({ allocationId: a.id, creditId: a.creditId, amount: a.amount.toFixed(2) })), activatedFundingIds: activated,
        expectedPublicationSequence: snapshot.groupChanges.expectedPublicationSequence } });
  }
}
