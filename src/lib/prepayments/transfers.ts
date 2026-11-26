import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runFinancialTransaction, type DbTransactionClient } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { calculateLiveOrderBalance, updateOrderBalance } from '@/lib/order-balance-service';
import { canonicalHash, conflict, PrepaymentError, transferRequestSchema, reverseTransferRequestSchema } from './contract';
import { creditInclude, resolveSources, poolNames, type CreditRow } from './sources';
import { refreshPendingPaymentNotifications } from './notifications';

type Tx = DbTransactionClient;
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
export function creditRevision(row: CreditRow, frozen: boolean) {
  return canonicalHash({ id: row.id, customerId: row.customerId, amount: row.amount.toFixed(2), active: row.funding.active, frozen,
    receiptStatus: row.funding.receipt?.status, received: row.funding.receivedAmount.toFixed(2),
    allocations: [...row.allocations].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map(a => ({ id: a.id, state: a.state, amount: a.amount.toFixed(2) })) });
}
async function scope(user: CurrentUser, tx: Tx, write = false) {
  if (write && user.role !== 'ADMIN') throw new PrepaymentError(403, 'FORBIDDEN', 'Administrator permission is required.');
  return [...(await getHierarchyScope(user, tx)).ownerVisibleIds];
}
async function requireCustomer(user: CurrentUser, tx: Tx, customerId: string) {
  const owners = await scope(user, tx, true);
  if (!await tx.customer.findFirst({ where: { id: customerId, ownerId: { in: owners } } })) throw new PrepaymentError(403, 'FORBIDDEN', 'Customer is outside your managed scope.');
}
async function isFrozen(tx: Tx, receiptId: string) {
  return Boolean(await tx.deletionRequest.findFirst({ where: { targetType: 'RECEIPT', targetId: receiptId, status: 'PENDING' } }));
}
function available(row: CreditRow) { return row.amount.minus(sum(row.allocations.map(a => a.amount))); }
async function loadCredit(tx: Tx, id: string) {
  const row = await tx.prepaymentCredit.findUnique({ where: { id }, include: creditInclude });
  if (!row) throw new PrepaymentError(404, 'PREPAYMENT_CREDIT_NOT_FOUND', 'Credit was not found.');
  return row;
}

export async function listPrepaymentCredits(user: CurrentUser, ownerIds?: string[]) {
  const owners = ownerIds || await scope(user, db);
  const customers = await db.customer.findMany({ where: { ownerId: { in: owners } }, select: { id: true, mark: true, orderName: true } });
  const names = new Map(customers.map(row => [row.id, row.mark || row.orderName]));
  const rows = await db.prepaymentCredit.findMany({ where: { customerId: { in: customers.map(row => row.id) }, amount: { gt: 0 } }, include: creditInclude, orderBy: { createdAt: 'asc' } });
  const pending = new Set((await db.deletionRequest.findMany({ where: { targetType: 'RECEIPT', status: 'PENDING',
    targetId: { in: rows.map(row => row.funding.originalReceiptId) } }, select: { targetId: true } })).map(row => row.targetId));
  const sources = new Map((await db.prepaymentSource.findMany({ where: { id: { in: rows.flatMap(row => row.sourceId ? [row.sourceId] : []) } },
    select: { id: true, originalOrderNo: true, orderId: true } })).map(row => [row.id, row]));
  const records = [];
  for (const row of rows) {
    const frozen = pending.has(row.funding.originalReceiptId);
    const active = row.funding.active && row.funding.receipt?.status !== 'SIGNING_PENDING' && Boolean(row.funding.receipt);
    const originVisible = names.has(row.funding.originalCustomerId);
    const reserved = sum(row.allocations.filter(a => a.state === 'RESERVED').map(a => a.amount));
    const used = sum(row.allocations.filter(a => a.state === 'APPLIED').map(a => a.amount));
    records.push({ creditId: row.id, receiptId: originVisible ? row.funding.originalReceiptId : null,
      receiptNo: originVisible ? row.funding.receipt?.receiptNo || null : null,
      customerId: row.customerId, customerLabel: names.get(row.customerId) || row.customerId,
      sourceOrderNo: (row.sourceId && sources.get(row.sourceId)?.originalOrderNo) || (originVisible ? row.funding.receipt?.orderNo || '' : ''),
      sourceOrderId: (row.sourceId && sources.get(row.sourceId)?.orderId) || null,
      originalOrderId: originVisible ? row.funding.originalOrderId : null,
      active,
      transferred: row.funding.originalCustomerId !== row.customerId,
      availableAmount: !frozen && active ? available(row).toFixed(2) : '0.00', held: frozen,
      usedAmount: used.toFixed(2), reservedAmount: reserved.toFixed(2),
      amount: row.amount.toFixed(2), revision: creditRevision(row, frozen) });
  }
  const transfers = user.role === 'ADMIN' ? await db.prepaymentTransfer.findMany({ where: {
    fromCredit: { customerId: { in: customers.map(row => row.id) } }, toCredit: { customerId: { in: customers.map(row => row.id) } },
  }, orderBy: { createdAt: 'desc' }, take: 50 }) : [];
  return { canTransfer: user.role === 'ADMIN', credits: records, transfers: transfers.map(row => ({
    id: row.id, fromCreditId: row.fromCreditId, toCreditId: row.toCreditId, amount: row.amount.toFixed(2),
    reason: row.reason, createdAt: row.createdAt, reversedAt: row.reversedAt,
  })) };
}

export async function searchTransferTargets(user: CurrentUser, search: string) {
  const owners = await scope(user, db, true);
  const term = search.trim();
  if (!term) return { targets: [] };
  const customers = await db.customer.findMany({ where: { ownerId: { in: owners } }, select: { id: true, mark: true, orderName: true } });
  const ids = customers.map(row => row.id); const labels = new Map(customers.map(row => [row.id, row.mark || row.orderName]));
  const orders = await db.order.findMany({ where: { canceledAt: null, customerId: { in: ids }, orderNo: { contains: term } }, include: { invoice: { select: { invNo: true } } }, take: 30, orderBy: { orderNo: 'asc' } });
  const trackers = await db.orderTracker.findMany({ where: { customerId: { in: ids }, archivedAt: null, orderNo: { contains: term } }, take: 30, orderBy: { orderNo: 'asc' } });
  return { targets: [
    ...orders.map(row => ({ binding: { type: 'LEDGER_ORDER', id: row.id }, customerId: row.customerId!, customerLabel: labels.get(row.customerId!), orderNo: row.orderNo, invoiceNo: row.invoice.invNo })),
    ...trackers.filter(row => !orders.some(order => order.id === row.financeOrderId)).map(row => ({ binding: { type: 'LEDGER_TRACKER', id: row.id }, customerId: row.customerId!, customerLabel: labels.get(row.customerId!), orderNo: row.orderNo, invoiceNo: null })),
  ] };
}

export async function transferPrepayment(user: CurrentUser, input: unknown) {
  const body = transferRequestSchema.parse(input);
  if (!new Prisma.Decimal(body.amount).gt(0)) conflict('Transfer amount must be positive.');
  return runFinancialTransaction(async tx => {
    const credit = await loadCredit(tx, body.creditId);
    await requireCustomer(user, tx, credit.customerId); await requireCustomer(user, tx, body.targetCustomerId);
    const hash = canonicalHash(body);
    const prior = await tx.prepaymentTransfer.findUnique({ where: { requestId: body.requestId } });
    if (prior) {
      if (prior.requestHash !== hash) conflict('Transfer request ID was reused with different content.');
      return { transferId: prior.id, amount: prior.amount.toFixed(2), reversed: Boolean(prior.reversedAt) };
    }
    const frozen = await isFrozen(tx, credit.funding.originalReceiptId);
    if (body.expectedRevision !== creditRevision(credit, frozen)) conflict('Credit balance changed. Refresh before transferring.', 'PREPAYMENT_REVISION_CONFLICT');
    if (frozen || !credit.funding.active || !credit.funding.receipt || credit.funding.receipt.status === 'SIGNING_PENDING') conflict('This receipt cannot be used while invalid or pending deletion.');
    if (available(credit).lt(body.amount)) conflict('Only unused and unreserved credit may be transferred.');
    const binding = body.targetBinding;
    let orderNo = ''; let targetOrderId: string | null = null;
    if (binding.type === 'LEDGER_ORDER') {
      const row = await tx.order.findUnique({ where: { id: binding.id } });
      if (!row || row.customerId !== body.targetCustomerId) conflict('Target ORDER customer does not match.');
      orderNo = row.orderNo; targetOrderId = row.id;
    } else if (binding.type === 'LEDGER_TRACKER') {
      const row = await tx.orderTracker.findUnique({ where: { id: binding.id } });
      if (!row || row.archivedAt || row.customerId !== body.targetCustomerId) conflict('Target business ORDER is unavailable.');
      orderNo = row.orderNo; targetOrderId = row.financeOrderId;
    } else {
      const row = await tx.prepaymentSource.findUnique({ where: { id: binding.id } });
      if (!row || row.customerId !== body.targetCustomerId) conflict('Target original ORDER is unavailable.');
      orderNo = row.originalOrderNo; targetOrderId = row.orderId;
    }
    const resolved = await resolveSources(tx, { invoiceBatchId: 'transfer-target', invoiceNo: 'transfer-target', currency: 'USD', invoiceTotal: '0.00', customers: [{
      billingGroupId: 'transfer-target', muledgerCustomerId: body.targetCustomerId, goodsAmount: '0.00', adjustmentAmount: '0.00', freightAmount: '0.00', totalAmount: '0.00',
      orderRefs: [{ binding, sourceOrderNo: orderNo, displayOrderNo: orderNo }],
    }] }, true);
    const source = resolved.sources.get('transfer-target')![0];
    targetOrderId = source.orderId || targetOrderId;
    if ((source.id === credit.sourceId || (!credit.sourceId && targetOrderId === credit.funding.originalOrderId))
      && body.targetCustomerId === credit.customerId) conflict('Source and destination are the same credit owner.');
    const destination = await tx.prepaymentCredit.create({ data: { fundingId: credit.fundingId, sourceId: source.id,
      customerId: body.targetCustomerId, orderTrackerId: source.orderTrackerId, amount: body.amount } });
    await tx.prepaymentCredit.update({ where: { id: credit.id }, data: { amount: { decrement: body.amount } } });
    const transfer = await tx.prepaymentTransfer.create({ data: { requestId: body.requestId, requestHash: hash, fromCreditId: credit.id,
      toCreditId: destination.id, amount: body.amount, actorId: user.id, reason: body.reason } });
    if (targetOrderId) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: targetOrderId }, include: { invoice: true, mucontGroup: true } });
      if (order.canceledAt) conflict('Target invoice group was canceled. Select an active order.');
      if (!poolNames.includes(order.invoice.invNo)) {
        if (order.mucontGroup && await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: order.mucontGroup.invoiceBatchId, state: 'RESERVED' } })) conflict('Target has a pending generated plan. Complete or cancel it before transferring.');
        const used = Prisma.Decimal.min(Prisma.Decimal.max(0, await calculateLiveOrderBalance(order.id, tx)), new Prisma.Decimal(body.amount));
        if (used.gt(0)) await tx.prepaymentAllocation.create({ data: { fundingId: credit.fundingId, creditId: destination.id,
          invoiceBatchId: order.mucontGroup?.invoiceBatchId, billingGroupId: order.mucontGroup?.billingGroupId,
          orderId: order.id, amount: used, state: 'APPLIED', appliedAt: new Date() } });
        await tx.order.update({ where: { id: order.id }, data: { paymentAllocationMode: true } });
        await updateOrderBalance(order.id, tx, { actorId: user.id, source: 'PREPAYMENT_ADMIN_TRANSFER' });
        await refreshPendingPaymentNotifications(tx, [order.id], user.id);
      }
    }
    await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_TRANSFER', actorId: user.id, targetType: 'PREPAYMENT_TRANSFER', targetId: transfer.id,
      metadata: { from: { creditId: credit.id, customerId: credit.customerId, amountBefore: credit.amount.toFixed(2) },
        to: { creditId: destination.id, customerId: body.targetCustomerId, binding, sourceId: source.id }, receiptId: credit.funding.originalReceiptId,
        amount: body.amount, reason: body.reason } });
    return { transferId: transfer.id, amount: transfer.amount.toFixed(2), reversed: false };
  });
}

export async function reversePrepaymentTransfer(user: CurrentUser, transferId: string, input: unknown) {
  const body = reverseTransferRequestSchema.parse(input);
  return runFinancialTransaction(async tx => {
    const transfer = await tx.prepaymentTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw new PrepaymentError(404, 'PREPAYMENT_TRANSFER_NOT_FOUND', 'Transfer was not found.');
    const from = await loadCredit(tx, transfer.fromCreditId); const to = await loadCredit(tx, transfer.toCreditId);
    await requireCustomer(user, tx, from.customerId); await requireCustomer(user, tx, to.customerId);
    if (transfer.reversedAt) return { transferId, reversed: true };
    if (available(to).lt(transfer.amount)) conflict('Transferred credit has been used, reserved or transferred onward. Reconcile that use before reversing.');
    await tx.prepaymentCredit.update({ where: { id: to.id }, data: { amount: { decrement: transfer.amount } } });
    await tx.prepaymentCredit.update({ where: { id: from.id }, data: { amount: { increment: transfer.amount } } });
    await tx.prepaymentTransfer.update({ where: { id: transfer.id }, data: { reversedAt: new Date(), reversedBy: user.id, reverseReason: body.reason } });
    await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_TRANSFER_REVERSED', actorId: user.id, targetType: 'PREPAYMENT_TRANSFER', targetId: transfer.id,
      metadata: { requestId: body.requestId, reason: body.reason, amount: transfer.amount.toFixed(2), fromCreditId: from.id, toCreditId: to.id } });
    return { transferId, reversed: true };
  });
}
