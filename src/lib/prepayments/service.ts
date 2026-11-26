import { randomUUID } from 'node:crypto';
import { Prisma, type PrepaymentPlan } from '@prisma/client';
import { db } from '@/lib/db';
import { runFinancialTransaction, runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { updateOrderBalance, calculateLiveOrderBalance } from '@/lib/order-balance-service';
import { receiptBalanceSelect, paymentAllocationsSelect } from './balance-select';
import { resolveSources, listGroupCandidates, activateCandidate, poolNames, type Candidate, type ResolvedSource } from './sources';
import { planCreditUse } from './planner';
import { refreshPendingPaymentNotifications } from './notifications';
import { validateGroupChanges, cancelRemovedGroups } from './group-cancellation';
import { canonicalHash, conflict, financialHash, previewRequestSchema, reserveRequestSchema, releaseRequestSchema,
  type FinancialSnapshot, type GroupQuote, type PlanReference, type PlanResponse, PrepaymentError } from './contract';

type Tx = DbTransactionClient;
const zero = () => new Prisma.Decimal(0);
const sum = (values: Prisma.Decimal[]) => values.reduce((a, b) => a.plus(b), zero());
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export async function prepaymentActor(tx: Tx) {
  const id = process.env.MUCONT_INVOICE_ACTOR_ID;
  const actor = id ? await tx.user.findFirst({ where: { id, role: 'ADMIN', disabledAt: null } }) : null;
  if (!actor) throw new PrepaymentError(503, 'SERVICE_ACTOR_UNAVAILABLE', 'An active integration administrator is required.');
  return actor;
}

async function requireSnapshotScope(tx: Tx, snapshot: FinancialSnapshot, actor: Awaited<ReturnType<typeof prepaymentActor>>) {
  // Scope is stable across an idempotent replay, even after groups are canceled.
  // Current publication/version validation belongs to quote and apply, not auth.
  const removed = snapshot.groupChanges ? await tx.mucontInvoiceGroup.findMany({ where: {
    invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: { in: snapshot.groupChanges.removedBillingGroupIds },
  }, select: { customerId: true } }) : [];
  const ids = [...new Set([...snapshot.customers.map(group => group.muledgerCustomerId), ...removed.map(g => g.customerId)])];
  const owners = [...(await getHierarchyScope(actor, tx)).ownerVisibleIds];
  if (await tx.customer.count({ where: { id: { in: ids }, ownerId: { in: owners } } }) !== ids.length) {
    throw new PrepaymentError(403, 'CUSTOMER_SCOPE_FORBIDDEN', 'All source customers must be in the integration administrator scope.');
  }
}

export function planRef(plan: PrepaymentPlan): PlanReference { return { planId: plan.id, version: plan.version, hash: plan.planHash }; }
export function planResult(plan: PrepaymentPlan, requestId = plan.requestId): PlanResponse {
  return { schemaVersion: 2, requestId, plan: planRef(plan), state: plan.state as PlanResponse['state'],
    financialHash: plan.financialHash, paymentSnapshotAt: plan.createdAt.toISOString(), snapshot: plan.snapshot as unknown as FinancialSnapshot,
    groups: plan.groups as unknown as PlanResponse['groups'], ledgerInvoiceId: plan.ledgerInvoiceId };
}
export async function requirePlan(tx: Tx, reference: PlanReference) {
  const plan = await tx.prepaymentPlan.findUnique({ where: { id: reference.planId } });
  if (!plan) throw new PrepaymentError(404, 'PREPAYMENT_PLAN_NOT_FOUND', 'Payment plan was not found.');
  if (plan.version !== reference.version || plan.planHash !== reference.hash) conflict('Payment plan reference does not match.', 'PREPAYMENT_PLAN_CONFLICT');
  return plan;
}

type QuoteDetail = { candidates: Candidate[]; linkedOrderId: string | null; paidBefore: Prisma.Decimal; sources: ResolvedSource[] };
async function buildQuote(tx: Tx, input: FinancialSnapshot) {
  await validateGroupChanges(tx, input);
  const resolved = await resolveSources(tx, input);
  const { snapshot, sources } = resolved;
  const hash = financialHash(snapshot);
  const latest = await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: snapshot.invoiceBatchId, state: { in: ['RESERVED', 'APPLIED'] } }, orderBy: { version: 'desc' } });
  const groups: GroupQuote[] = [];
  const details = new Map<string, QuoteDetail>();
  for (const group of snapshot.customers) {
    const customer = await tx.customer.findUnique({ where: { id: group.muledgerCustomerId }, select: { id: true } });
    if (!customer) conflict('Customer binding no longer exists.', 'PREPAYMENT_SOURCE_CONFLICT');
    const result = await listGroupCandidates(tx, snapshot, group, sources.get(group.billingGroupId)!);
    const order = result.linked ? await tx.order.findUniqueOrThrow({ where: { id: result.linked.orderId },
      include: { receipts: { select: receiptBalanceSelect }, paymentAllocations: paymentAllocationsSelect } }) : null;
    const direct = sum((order?.receipts || []).filter(row => !row.funding && row.status !== 'SIGNING_PENDING').map(row => row.usd));
    const allocated = sum((order?.paymentAllocations || []).filter(row => row.funding.active && row.funding.receipt && row.funding.receipt.status !== 'SIGNING_PENDING').map(row => row.amount));
    const own = sum(result.candidates.map(row => row.applied));
    const paidBefore = direct.plus(allocated).minus(own);
    const calculation = planCreditUse(group.totalAmount, paidBefore.toFixed(2), result.candidates.map(row => ({
      creditId: row.creditId, receiptId: row.receiptId, available: row.available.toFixed(2), applied: row.applied.toFixed(2),
    })));
    groups.push({ billingGroupId: group.billingGroupId, muledgerCustomerId: group.muledgerCustomerId, totalAmount: group.totalAmount,
      paidAmount: direct.plus(allocated).toFixed(2), availableAmount: sum(result.candidates.map(row => row.available)).toFixed(2),
      additionalAmount: sum(calculation.reservations.map(row => new Prisma.Decimal(row.amount))).toFixed(2), remainingAmount: calculation.remainingAmount,
      sources: result.candidates.map(row => ({ creditId: row.creditId, receiptId: row.receiptId, receiptNo: row.receiptNo,
        sourceOrderNo: row.sourceOrderNo, originCustomerId: row.originCustomerId, availableAmount: row.available.toFixed(2),
        usedAmount: row.totalApplied.toFixed(2), reservedAmount: row.reserved.toFixed(2) })) });
    details.set(group.billingGroupId, { candidates: result.candidates, linkedOrderId: result.linked?.orderId || null, paidBefore,
      sources: sources.get(group.billingGroupId)! });
  }
  const previousPlan = latest ? planRef(latest) : null;
  const revision = canonicalHash({ financialHash: hash, previousPlan, groups });
  return { response: { schemaVersion: 2 as const, financialHash: hash, revision, calculatedAt: new Date().toISOString(), snapshot, previousPlan, groups }, details, latest };
}

export async function previewPrepayments(input: unknown) {
  const body = previewRequestSchema.parse(input);
  return runInTransaction(async tx => {
    const actor = await prepaymentActor(tx);
    await requireSnapshotScope(tx, body.snapshot, actor);
    return (await buildQuote(tx, body.snapshot)).response;
  }, { isolationLevel: 'RepeatableRead' });
}

export async function reservePrepayments(input: unknown) {
  const body = reserveRequestSchema.parse(input);
  const requestHash = canonicalHash(body);
  return runFinancialTransaction(async tx => {
    const actor = await prepaymentActor(tx);
    await requireSnapshotScope(tx, body.snapshot, actor);
    const prior = await tx.prepaymentPlan.findUnique({ where: { requestId: body.requestId } });
    if (prior) {
      if (prior.requestHash !== requestHash) conflict('Request ID was reused with different content.', 'PREPAYMENT_REQUEST_CONFLICT');
      return planResult(prior);
    }
    const reuseIntent = await tx.mutationIntent.findUnique({ where: { id: canonicalHash(['PREPAYMENT_REUSE', body.requestId]) } });
    if (reuseIntent) {
      if (reuseIntent.fingerprint !== requestHash) conflict('Request ID was reused with different content.');
      return planResult(await requirePlan(tx, reuseIntent.result as unknown as PlanReference), body.requestId);
    }
    if (body.mode === 'REUSE') {
      if (!body.previousPlan || body.expectedRevision !== null) conflict('REUSE requires a previous plan and no quote revision.');
      const plan = await requirePlan(tx, body.previousPlan);
      if (!['RESERVED', 'APPLIED'].includes(plan.state) || plan.financialHash !== financialHash(body.snapshot)) conflict('This financial plan cannot be reused.');
      await tx.mutationIntent.create({ data: { id: canonicalHash(['PREPAYMENT_REUSE', body.requestId]), actorId: actor.id,
        kind: 'PREPAYMENT_REUSE', fingerprint: requestHash, result: json(planRef(plan)), completed: true } });
      return planResult(plan, body.requestId);
    }
    const quote = await buildQuote(tx, body.snapshot);
    if (!body.expectedRevision || body.expectedRevision !== quote.response.revision) conflict('Available funds changed. Refresh the preview.', 'PREPAYMENT_REVISION_CONFLICT');
    if (quote.latest?.state === 'RESERVED') conflict('This invoice already has a pending plan. Reuse or cancel it first.', 'PREPAYMENT_PLAN_PENDING');
    if (canonicalHash(body.previousPlan) !== canonicalHash(quote.response.previousPlan)) conflict('The previous financial plan changed.', 'PREPAYMENT_PLAN_CONFLICT');
    const resolved = await resolveSources(tx, quote.response.snapshot, true);
    const groups: PlanResponse['groups'] = [];
    const reservations: Array<{ creditId: string; fundingId: string; billingGroupId: string; amount: string }> = [];
    const touchedOrders = new Set<string>();
    for (const group of resolved.snapshot.customers) {
      const detail = quote.details.get(group.billingGroupId)!;
      const candidates: Candidate[] = [];
      for (const row of detail.candidates) {
        let candidate = row;
        if (row.legacyReceiptId) {
          const raw = await tx.receipt.findUniqueOrThrow({ where: { id: row.legacyReceiptId } });
          const source = resolved.sources.get(group.billingGroupId)!.find(item => item.orderId === raw.orderId);
          candidate = await activateCandidate(tx, { ...row, sourceId: source?.id || null }, group, resolved.snapshot.invoiceBatchId, detail.linkedOrderId);
          if (raw.orderId) touchedOrders.add(raw.orderId);
        }
        candidates.push(candidate);
      }
      const calculation = planCreditUse(group.totalAmount, detail.paidBefore.toFixed(2), candidates.map(row => ({
        creditId: row.creditId, receiptId: row.receiptId, available: row.available.toFixed(2), applied: row.applied.toFixed(2),
      })));
      for (const row of calculation.reservations) reservations.push({ creditId: row.creditId, fundingId: candidates.find(c => c.creditId === row.creditId)!.fundingId!,
        billingGroupId: group.billingGroupId, amount: row.amount });
      const { reservations: _reservations, ...payment } = calculation;
      groups.push({ billingGroupId: group.billingGroupId, muledgerCustomerId: group.muledgerCustomerId, totalAmount: group.totalAmount, ...payment });
    }
    const version = ((await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: resolved.snapshot.invoiceBatchId }, orderBy: { version: 'desc' } }))?.version || 0) + 1;
    const createdAt = new Date();
    const id = randomUUID();
    const hash = financialHash(resolved.snapshot);
    const planHash = canonicalHash({ schemaVersion: 2, planId: id, version, financialHash: hash,
      paymentSnapshotAt: createdAt.toISOString(), snapshot: resolved.snapshot, groups });
    const plan = await tx.prepaymentPlan.create({ data: { id, invoiceBatchId: resolved.snapshot.invoiceBatchId, version,
      requestId: body.requestId, requestHash, financialHash: hash, planHash, snapshot: json(resolved.snapshot), groups: json(groups),
      previousPlanId: quote.latest?.id || null, createdBy: actor.id, createdAt } });
    for (const row of reservations) await tx.prepaymentAllocation.create({ data: { ...row, amount: row.amount,
      planId: plan.id, invoiceBatchId: plan.invoiceBatchId, state: 'RESERVED' } });
    for (const orderId of touchedOrders) await updateOrderBalance(orderId, tx, { actorId: actor.id, source: 'PREPAYMENT_ENABLE' });
    await refreshPendingPaymentNotifications(tx, [...touchedOrders], actor.id);
    await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_RESERVED', actorId: actor.id, targetType: 'PREPAYMENT_PLAN', targetId: plan.id,
      metadata: { requestId: body.requestId, previousPlan: body.previousPlan, snapshot: resolved.snapshot, groups } });
    return planResult(plan);
  });
}

export async function readPrepaymentPlan(input: { planId?: string; requestId?: string }) {
  await prepaymentActor(db);
  let plan = input.planId ? await db.prepaymentPlan.findUnique({ where: { id: input.planId } })
    : input.requestId ? await db.prepaymentPlan.findUnique({ where: { requestId: input.requestId } }) : null;
  if (!plan && input.requestId) {
    const intent = await db.mutationIntent.findUnique({ where: { id: canonicalHash(['PREPAYMENT_REUSE', input.requestId]) } });
    if (intent) plan = await requirePlan(db, intent.result as unknown as PlanReference);
  }
  if (!plan) throw new PrepaymentError(404, 'PREPAYMENT_PLAN_NOT_FOUND', 'Payment plan was not found.');
  return planResult(plan, input.requestId || plan.requestId);
}

export async function releasePrepaymentPlan(planId: string, input: unknown) {
  const body = releaseRequestSchema.parse(input);
  return runFinancialTransaction(async tx => {
    const actor = await prepaymentActor(tx);
    const plan = await tx.prepaymentPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new PrepaymentError(404, 'PREPAYMENT_PLAN_NOT_FOUND', 'Payment plan was not found.');
    if (plan.version !== body.expectedVersion) conflict('Payment plan version changed.');
    if (plan.state === 'RELEASED') return planResult(plan);
    if (plan.state !== 'RESERVED') conflict('An applied payment plan cannot be cancelled.', 'PREPAYMENT_ALREADY_APPLIED');
    await tx.prepaymentAllocation.updateMany({ where: { planId, state: 'RESERVED' }, data: { state: 'RELEASED', releasedAt: new Date() } });
    const released = await tx.prepaymentPlan.update({ where: { id: planId }, data: { state: 'RELEASED', releasedAt: new Date() } });
    await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_RELEASED', actorId: actor.id, targetType: 'PREPAYMENT_PLAN', targetId: planId,
      metadata: { requestId: body.requestId, before: 'RESERVED', after: 'RELEASED', reason: body.reason } });
    return planResult(released);
  });
}

export async function validatePlanForApplication(tx: Tx, reference: PlanReference, snapshot: FinancialSnapshot) {
  const plan = await requirePlan(tx, reference);
  if (!['RESERVED', 'APPLIED'].includes(plan.state) || financialHash(snapshot) !== plan.financialHash) conflict('Generation does not reference an active matching financial plan.', 'PREPAYMENT_PLAN_CONFLICT');
  // An applied removal has already changed the publication sequence. Recheck
  // remaining active groups rather than trying to remove the same groups again.
  await validateGroupChanges(tx, plan.state === 'APPLIED' ? { ...snapshot, groupChanges: undefined } : snapshot);
  const latest = await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: plan.invoiceBatchId, state: 'APPLIED' }, orderBy: { version: 'desc' } });
  if (plan.state === 'APPLIED' && await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: plan.invoiceBatchId, state: 'RESERVED' } })) {
    conflict('A newer generation has reserved a payment plan. Complete or cancel it before reusing this plan.');
  }
  if (plan.state === 'APPLIED' && latest?.id !== plan.id) conflict('The financial plan has been superseded.');
  if (plan.state === 'RESERVED' && (latest?.id || null) !== plan.previousPlanId) conflict('Current invoice funding changed after reservation.');
  const groups = plan.groups as unknown as PlanResponse['groups'];
  if (plan.state === 'APPLIED') {
    for (const group of groups) {
      const target = await tx.mucontInvoiceGroup.findUniqueOrThrow({ where: { invoiceBatchId_billingGroupId: {
        invoiceBatchId: plan.invoiceBatchId, billingGroupId: group.billingGroupId } }, include: { order: true } });
      const paid = target.order.amount.minus(await calculateLiveOrderBalance(target.orderId, tx));
      if (paid.gt(group.totalAmount)) conflict('New payments exceed this frozen receivable. Recalculate before synchronizing.');
    }
  }
  for (const group of groups) for (const line of group.allocations) {
    const credit = await tx.prepaymentCredit.findUniqueOrThrow({ where: { id: line.creditId }, include: { funding: { include: { receipt: true } } } });
    if (credit.customerId !== group.muledgerCustomerId || !credit.funding.active || !credit.funding.receipt
      || credit.funding.receipt.status === 'SIGNING_PENDING') conflict('A payment source is no longer valid.');
    if (await tx.deletionRequest.findFirst({ where: { targetType: 'RECEIPT', targetId: credit.funding.originalReceiptId, status: 'PENDING' } })) {
      conflict('A payment source is awaiting deletion approval. Resolve it before applying the plan.');
    }
  }
  return plan;
}

export async function planFundingPools(tx: Tx, snapshot: FinancialSnapshot) {
  const resolved = await resolveSources(tx, snapshot);
  const ids = [...resolved.sources.values()].flat().flatMap(source => source.orderId ? [source.orderId] : []);
  const rows = await tx.order.findMany({ where: { id: { in: ids }, amount: 0,
    mucontGroup: null, invoice: { invNo: { in: poolNames } } },
    select: { id: true, paymentAllocationMode: true, _count: { select: { receipts: true } } } });
  const allowed: string[] = [];
  for (const row of rows) {
    if (row.paymentAllocationMode) allowed.push(row.id);
    else if (row._count.receipts === 0 && !await tx.balanceTransfer.count({ where: {
      OR: [{ fromOrderId: row.id }, { toOrderId: row.id }],
    } })) allowed.push(row.id);
  }
  return allowed;
}

export async function applyPlan(tx: Tx, reference: PlanReference, ledgerInvoiceId: string, actorId: string) {
  const plan = await requirePlan(tx, reference);
  if (plan.state === 'APPLIED') return;
  if (plan.state !== 'RESERVED') conflict('Only a reserved plan may be applied.');
  const groups = plan.groups as unknown as PlanResponse['groups'];
  const before = await tx.prepaymentAllocation.findMany({ where: { invoiceBatchId: plan.invoiceBatchId, state: 'APPLIED' } });
  await cancelRemovedGroups(tx, plan.snapshot as unknown as FinancialSnapshot, actorId);
  await tx.prepaymentAllocation.updateMany({ where: { invoiceBatchId: plan.invoiceBatchId, state: 'APPLIED' }, data: { state: 'RELEASED', releasedAt: new Date() } });
  await tx.prepaymentAllocation.updateMany({ where: { planId: plan.id, state: 'RESERVED' }, data: { state: 'RELEASED', releasedAt: new Date() } });
  for (const group of groups) {
    const target = await tx.mucontInvoiceGroup.findUniqueOrThrow({ where: { invoiceBatchId_billingGroupId: { invoiceBatchId: plan.invoiceBatchId, billingGroupId: group.billingGroupId } } });
    for (const line of group.allocations) {
      const credit = await tx.prepaymentCredit.findUniqueOrThrow({ where: { id: line.creditId }, include: { allocations: { where: { state: { in: ['APPLIED', 'RESERVED'] } } } } });
      const occupied = sum(credit.allocations.map(row => row.amount));
      if (occupied.plus(line.amount).gt(credit.amount)) conflict('The payment source no longer has sufficient funds.');
      // Retained portions keep their original application date. Re-rendering or
      // reducing a plan must not move a customer's historical payment forward.
      let remaining = new Prisma.Decimal(line.amount);
      const portions = before.filter(row => row.creditId === credit.id && row.billingGroupId === group.billingGroupId)
        .sort((a, b) => (a.appliedAt?.getTime() || 0) - (b.appliedAt?.getTime() || 0));
      for (const portion of [...portions, { amount: remaining, appliedAt: new Date() }]) {
        const amount = Prisma.Decimal.min(remaining, portion.amount);
        if (!amount.gt(0)) continue;
        await tx.prepaymentAllocation.create({ data: { planId: plan.id, fundingId: credit.fundingId, creditId: credit.id,
          invoiceBatchId: plan.invoiceBatchId, billingGroupId: group.billingGroupId, orderId: target.orderId,
          amount, state: 'APPLIED', appliedAt: portion.appliedAt || new Date() } });
        remaining = remaining.minus(amount);
      }
    }
    await tx.order.update({ where: { id: target.orderId }, data: { paymentAllocationMode: true } });
    const result = await updateOrderBalance(target.orderId, tx, { actorId, source: 'PREPAYMENT_APPLIED' });
    if (!new Prisma.Decimal(result.computed).equals(group.remainingAmount)) conflict('Invoice payments changed after rendering. Generate a fresh funding plan.', 'PREPAYMENT_REVISION_CONFLICT');
    await refreshPendingPaymentNotifications(tx, [target.orderId], actorId);
  }
  if (plan.previousPlanId) await tx.prepaymentPlan.update({ where: { id: plan.previousPlanId }, data: { state: 'SUPERSEDED' } });
  await tx.prepaymentPlan.update({ where: { id: plan.id }, data: { state: 'APPLIED', appliedAt: new Date(), ledgerInvoiceId } });
  await recordAuditEventInTransaction(tx, { action: 'PREPAYMENT_APPLIED', actorId, targetType: 'PREPAYMENT_PLAN', targetId: plan.id,
    metadata: { invoiceBatchId: plan.invoiceBatchId, ledgerInvoiceId, before: json(before), after: groups } });
}
