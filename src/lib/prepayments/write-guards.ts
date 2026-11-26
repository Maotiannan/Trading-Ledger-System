import { Prisma } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { createApiError } from '@/lib/api-error';
import { updateOrderBalance, calculateLiveOrderBalance } from '@/lib/order-balance-service';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { isAllocationWriteAuthorized } from './write-context';
import { poolNames } from './sources';
import type { FinancialSnapshot } from './contract';

type Tx = DbTransactionClient;
const blocked = (message: string): never => { throw createApiError({ code: 'CONFLICT', status: 409, message }); };
const value = (data: Record<string, unknown>, key: string) => {
  const item = data[key]; return item && typeof item === 'object' && 'set' in item ? (item as { set: unknown }).set : item;
};
const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));

export async function guardPrepaymentCustomerRemoval(tx: Tx, ids: string[]) {
  if (!tx.receiptFunding || !ids.length) return;
  if (await tx.receiptFunding.count({ where: { originalCustomerId: { in: ids } } })
    || await tx.prepaymentCredit.count({ where: { customerId: { in: ids } } })) {
    blocked('This customer has prepayment funding history. Preserve the customer identity and reconcile the credit before removal.');
  }
}

export async function guardPrepaymentWrites(tx: Tx, model: 'order' | 'receipt', method: string, args: Record<string, unknown>, ids: string[]) {
  if (!tx.receiptFunding || isAllocationWriteAuthorized(tx)) return;
  const dataRows = (Array.isArray(args.data) ? args.data : [args.data, args.create, args.update].filter(Boolean)) as Array<Record<string, unknown>>;
  if (model === 'order') {
    const sensitive = method.startsWith('delete') || dataRows.some(row => ['amount', 'invoiceId', 'invoice', 'orderNo', 'customerId', 'customer'].some(key => Object.hasOwn(row, key)));
    if (sensitive && ids.length && await tx.order.count({ where: { id: { in: ids }, paymentAllocationMode: true } })) {
      blocked('This order uses allocated payments. Change its receivable through the invoice funding plan; do not use legacy merge, delete or balance transfer.');
    }
    return;
  }
  const rows = ids.length ? await tx.receipt.findMany({ where: { id: { in: ids } },
    include: { funding: { include: { credits: true, allocations: { where: { state: { in: ['APPLIED', 'RESERVED'] } } } } } },
  }) : [];
  for (const row of rows) {
    if (!row.funding) continue;
    for (const data of dataRows.length ? dataRows : [{}]) {
      const changingIdentity = ['order', 'customer'].some(key => Object.hasOwn(data, key))
        || ['orderId', 'customerId'].some(key => Object.hasOwn(data, key) && !same(value(data, key), row[key as 'orderId' | 'customerId']));
      const changingAmount = Object.hasOwn(data, 'usd') && !same(value(data, 'usd'), row.usd);
      const becomingPending = Object.hasOwn(data, 'status') && value(data, 'status') === 'SIGNING_PENDING' && row.status !== 'SIGNING_PENDING';
      const removing = method.startsWith('delete');
      if (!(changingIdentity || changingAmount || becomingPending || removing)) continue;
      if (row.funding.allocations.length || row.funding.credits.length !== 1) blocked('This receipt has allocated, reserved or transferred funds. Reconcile those uses before changing or deleting the receipt.');
      if (changingIdentity) blocked('Allocated-mode receipts keep their original identity. Transfer unused credit explicitly instead of rebinding the original receipt.');
      const pending = (value(data, 'status') ?? row.status) === 'SIGNING_PENDING';
      const next = removing || pending ? new Prisma.Decimal(0) : new Prisma.Decimal(String(value(data, 'usd') ?? row.usd));
      if (next.isNegative() || !next.isFinite()) blocked('Invalid receipt amount.');
      await tx.receiptFunding.update({ where: { id: row.funding.id }, data: { receivedAmount: next, active: !removing && !pending } });
      await tx.prepaymentCredit.update({ where: { id: row.funding.credits[0].id }, data: { amount: next } });
    }
  }
  const targetIds = new Set(rows.map(row => row.orderId).filter((id): id is string => Boolean(id)));
  for (const data of dataRows) {
    const orderId = value(data, 'orderId');
    if (typeof orderId === 'string') targetIds.add(orderId);
    const relation = data.order as { connect?: { id?: string } } | undefined;
    if (relation?.connect?.id) targetIds.add(relation.connect.id);
  }
  const monetary = method.startsWith('create') || method.startsWith('delete') || dataRows.some(row => ['usd', 'orderId', 'order', 'customerId', 'customer'].some(key => Object.hasOwn(row, key))
    || value(row, 'status') === 'SIGNING_PENDING' || rows.some(old => old.status === 'SIGNING_PENDING' && Object.hasOwn(row, 'status')));
  if (monetary && targetIds.size) {
    const receivingIds = new Set<string>();
    for (const data of dataRows) {
      const relation = data.order as { connect?: { id?: string }; disconnect?: boolean } | undefined;
      const rebind = Object.hasOwn(data, 'orderId') || Object.hasOwn(data, 'order');
      for (const old of rows.length ? rows : [{ orderId: null, status: null }]) {
        if (!method.startsWith('create') && !rebind
          && !(old.status === 'SIGNING_PENDING' && Object.hasOwn(data, 'status') && value(data, 'status') !== 'SIGNING_PENDING')) continue;
        const destination = Object.hasOwn(data, 'orderId') ? value(data, 'orderId')
          : relation ? relation.connect?.id : old.orderId;
        if (typeof destination === 'string') receivingIds.add(destination);
      }
    }
    if (receivingIds.size && await tx.order.count({ where: { id: { in: [...receivingIds] }, canceledAt: { not: null } } })) {
      blocked('This invoice group was canceled. Select an active order before receiving or finalizing a payment.');
    }
    const groups = await tx.mucontInvoiceGroup.findMany({ where: { orderId: { in: [...targetIds] } }, select: { invoiceBatchId: true } });
    if (groups.length && await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: { in: groups.map(row => row.invoiceBatchId) }, state: 'RESERVED' } })) {
      blocked('An invoice generation is using a frozen payment plan. Complete or cancel that generation before changing its receipts.');
    }
  }
}

export async function allocateNewReceipt(tx: Tx, receiptId: string) {
  if (!tx.receiptFunding || isAllocationWriteAuthorized(tx)) return;
  const receipt = await tx.receipt.findUnique({ where: { id: receiptId }, include: { funding: true,
    order: { include: { invoice: true, mucontGroup: true } }, generatedByBalanceTransfer: true } });
  if (!receipt?.order?.paymentAllocationMode || receipt.generatedByBalanceTransfer) return;
  const order = receipt.order;
  if (!order.customerId || (receipt.customerId && receipt.customerId !== order.customerId)) blocked('Receipt customer must agree with the allocated order.');
  // Recovery recreates the same receipt ID; reconnect its original root, including
  // pending signatures, rather than silently creating income a second time.
  const existing = await tx.receiptFunding.findUnique({ where: { originalReceiptId: receipt.id },
    include: { credits: true, allocations: { where: { state: { in: ['APPLIED', 'RESERVED'] } } } } });
  const active = receipt.status !== 'SIGNING_PENDING' && receipt.usd.gt(0);
  if (existing) {
    if (existing.receiptId === receipt.id && existing.active === active) return;
    if (existing.originalOrderId !== order.id || existing.originalCustomerId !== order.customerId
      || existing.credits.length !== 1 || existing.allocations.length) blocked('Restored receipt funding no longer matches its original unspent source.');
    const amount = active ? receipt.usd : new Prisma.Decimal(0);
    await tx.receiptFunding.update({ where: { id: existing.id }, data: { receiptId: receipt.id, active, receivedAmount: amount } });
    await tx.prepaymentCredit.update({ where: { id: existing.credits[0].id }, data: { amount } });
    const used = !active || poolNames.includes(order.invoice.invNo) ? new Prisma.Decimal(0)
      : Prisma.Decimal.min(amount, Prisma.Decimal.max(0, await calculateLiveOrderBalance(order.id, tx)));
    if (used.gt(0)) await tx.prepaymentAllocation.create({ data: { fundingId: existing.id, creditId: existing.credits[0].id,
      orderId: order.id, invoiceBatchId: order.mucontGroup?.invoiceBatchId, billingGroupId: order.mucontGroup?.billingGroupId,
      amount: used, state: 'APPLIED', appliedAt: new Date() } });
    await updateOrderBalance(order.id, tx, { actorId: receipt.createdBy, source: 'PREPAYMENT_RECEIPT_RESTORED' });
    await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_RECEIPT_RESTORED', actorId: receipt.createdBy,
      targetType: 'RECEIPT', targetId: receipt.id, metadata: { fundingId: existing.id, active, received: amount.toFixed(2), used: used.toFixed(2) } });
    return;
  }
  if (!active) return;
  const source = await tx.prepaymentSource.findUnique({ where: { orderId: order.id } });
  const originPlan = order.mucontGroup ? await tx.prepaymentPlan.findFirst({ where: {
    invoiceBatchId: order.mucontGroup.invoiceBatchId, state: 'APPLIED',
  }, orderBy: { version: 'desc' } }) : null;
  const originGroup = (originPlan?.snapshot as FinancialSnapshot | undefined)?.customers
    .find(group => group.billingGroupId === order.mucontGroup?.billingGroupId);
  const originSourceIds = originGroup?.orderRefs.flatMap(ref => ref.binding?.type === 'LEDGER_SOURCE' ? [ref.binding.id] : []) || [];
  const funding = await tx.receiptFunding.create({ data: { receiptId: receipt.id, originalReceiptId: receipt.id, originalOrderId: order.id,
    originalCustomerId: order.customerId!, receivedAmount: receipt.usd,
    receiptSnapshot: { receiptId: receipt.id, receiptNo: receipt.receiptNo, usd: receipt.usd.toFixed(2), orderId: order.id,
      customerId: receipt.customerId, createdAt: receipt.createdAt.toISOString(), createdBy: receipt.createdBy,
      originPlanId: originPlan?.id || null, originSourceIds } } });
  const credit = await tx.prepaymentCredit.create({ data: { fundingId: funding.id, sourceId: source?.id, customerId: order.customerId!, amount: receipt.usd,
    invoiceBatchId: order.mucontGroup?.invoiceBatchId, billingGroupId: order.mucontGroup?.billingGroupId } });
  const used = poolNames.includes(order.invoice.invNo) ? new Prisma.Decimal(0)
    : Prisma.Decimal.min(receipt.usd, Prisma.Decimal.max(0, await calculateLiveOrderBalance(order.id, tx)));
  if (used.gt(0)) await tx.prepaymentAllocation.create({ data: { fundingId: funding.id, creditId: credit.id, orderId: order.id,
    invoiceBatchId: order.mucontGroup?.invoiceBatchId, billingGroupId: order.mucontGroup?.billingGroupId, amount: used, state: 'APPLIED', appliedAt: receipt.createdAt } });
  await updateOrderBalance(order.id, tx, { actorId: receipt.createdBy, source: 'PREPAYMENT_RECEIPT_RECEIVED' });
  await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_RECEIPT_ALLOCATED', actorId: receipt.createdBy, targetType: 'RECEIPT', targetId: receipt.id,
    metadata: { fundingId: funding.id, orderId: order.id, received: receipt.usd.toFixed(2), used: used.toFixed(2), unused: receipt.usd.minus(used).toFixed(2) } });
}
