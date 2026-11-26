import { Prisma } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import { conflict, type FinancialSnapshot } from './contract';

type Tx = DbTransactionClient;
export type ResolvedSource = {
  id: string | null; customerId: string; orderTrackerId: string | null; orderId: string | null;
  sourcePiId: string | null; originalOrderNo: string; normalizedOrderNo: string;
};
export const poolNames = ['DEPOSIT_POOL', 'Un_Associated'];

export async function resolveSources(tx: Tx, input: FinancialSnapshot, persist = false) {
  const snapshot = structuredClone(input);
  const sources = new Map<string, ResolvedSource[]>();
  for (const group of snapshot.customers) {
    const entries: ResolvedSource[] = [];
    for (const ref of group.orderRefs) {
      const normalized = normalizeOrderIdentifier(ref.sourceOrderNo);
      let row: ResolvedSource | null = null;
      let trackerId: string | null = null;
      let orderId: string | null = null;
      let piId: string | null = null;
      if (ref.binding?.type === 'LEDGER_SOURCE') {
        row = await tx.prepaymentSource.findUnique({ where: { id: ref.binding.id } });
        if (!row || row.customerId !== group.muledgerCustomerId) conflict('Original ORDER source is unavailable or belongs to another customer.', 'PREPAYMENT_SOURCE_CONFLICT');
      } else if (ref.binding?.type === 'MUCONT_PI') {
        piId = ref.binding.id;
        row = await tx.prepaymentSource.findUnique({ where: { sourcePiId: piId } });
        const link = await tx.externalOrderSourceLink.findUnique({ where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: piId } }, include: { orderTracker: true } });
        if (link) {
          if (!link.orderTracker || link.orderTracker.customerId !== group.muledgerCustomerId) conflict('PI customer binding must be resolved before using funds.', 'PREPAYMENT_SOURCE_CONFLICT');
          trackerId = link.orderTracker.id;
          orderId = link.orderTracker.financeOrderId;
          if (!row && normalizeOrderIdentifier(link.sourceOrderNo) !== normalized
            && normalizeOrderIdentifier(link.orderTracker.orderNo) !== normalized) conflict('PI binding and original ORDER name disagree.', 'PREPAYMENT_SOURCE_CONFLICT');
        }
      } else if (ref.binding?.type === 'LEDGER_TRACKER') {
        trackerId = ref.binding.id;
        const tracker = await tx.orderTracker.findUnique({ where: { id: trackerId } });
        if (!tracker || tracker.customerId !== group.muledgerCustomerId) conflict('Original ORDER customer does not match.', 'PREPAYMENT_SOURCE_CONFLICT');
        orderId = tracker.financeOrderId;
        row = await tx.prepaymentSource.findUnique({ where: { orderTrackerId: trackerId } });
        if (!row && normalizeOrderIdentifier(tracker.orderNo) !== normalized) conflict('Tracker binding and original ORDER name disagree.', 'PREPAYMENT_SOURCE_CONFLICT');
      } else if (ref.binding?.type === 'LEDGER_ORDER') {
        orderId = ref.binding.id;
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || order.customerId !== group.muledgerCustomerId) conflict('Original financial ORDER customer does not match.', 'PREPAYMENT_SOURCE_CONFLICT');
        row = await tx.prepaymentSource.findUnique({ where: { orderId } });
        if (!row && normalizeOrderIdentifier(order.orderNo) !== normalized) conflict('Financial ORDER binding and original name disagree.', 'PREPAYMENT_SOURCE_CONFLICT');
      }
      if (!row) {
        const byName = await tx.prepaymentSource.findUnique({ where: { customerId_normalizedOrderNo: { customerId: group.muledgerCustomerId, normalizedOrderNo: normalized } } });
        if (byName && ref.binding) {
          const compatible = (piId && byName.sourcePiId === piId) || (trackerId && byName.orderTrackerId === trackerId)
            || (orderId && byName.orderId === orderId);
          if (!compatible) conflict('The explicit source binding and ORDER name resolve to different records.', 'PREPAYMENT_SOURCE_CONFLICT');
        }
        row = byName;
      }
      if (row && row.customerId !== group.muledgerCustomerId) conflict('Original source belongs to another customer.');
      if (!row) {
        if (!trackerId && (!ref.binding || ref.binding.type === 'MUCONT_PI')) {
          const tracker = await tx.orderTracker.findUnique({ where: { normalizedOrderNo: normalized } });
          if (tracker) {
            if (tracker.customerId !== group.muledgerCustomerId) conflict('ORDER tracker customer does not match.', 'PREPAYMENT_SOURCE_CONFLICT');
            if (orderId && tracker.financeOrderId !== orderId) conflict('Tracker and financial ORDER bindings disagree.', 'PREPAYMENT_SOURCE_CONFLICT');
            if (piId) {
              const evidence = await tx.externalOrderSourceLink.findUnique({ where: { provider_externalId: { provider: 'MU_CONTRACT', externalId: piId } } });
              if (evidence?.orderTrackerId !== tracker.id) conflict('PI and tracker lineage is not established.', 'PREPAYMENT_SOURCE_CONFLICT');
            }
            trackerId = tracker.id; orderId ||= tracker.financeOrderId;
          }
        }
        if (!orderId) {
          const orders = await tx.order.findMany({ where: { orderNo: ref.sourceOrderNo }, select: { id: true, customerId: true } });
          if (orders.length > 1 || orders.some(order => order.customerId !== group.muledgerCustomerId)) conflict('Original ORDER is ambiguous or belongs to another customer.', 'PREPAYMENT_SOURCE_CONFLICT');
          orderId = orders[0]?.id || null;
        }
        row = { id: null, customerId: group.muledgerCustomerId, orderTrackerId: trackerId, orderId,
          sourcePiId: piId, originalOrderNo: ref.sourceOrderNo, normalizedOrderNo: normalized };
      }
      // A durable unbilled source may later gain a real ledger order. Resolve only
      // its stored exact identity; never infer shipment suffixes.
      if (!row.orderId) {
        const orders = await tx.order.findMany({ where: { customerId: row.customerId, orderNo: row.originalOrderNo }, select: { id: true } });
        if (orders.length > 1) conflict('Original ORDER now resolves to multiple financial rows.');
        if (orders.length) row = { ...row, orderId: orders[0].id };
      }
      if (row.orderId) {
        const current = await tx.order.findUnique({ where: { id: row.orderId }, select: { customerId: true } });
        if (!current || current.customerId !== row.customerId) conflict('The stable source ORDER customer has changed.', 'PREPAYMENT_SOURCE_CONFLICT');
      }
      if (row.orderTrackerId) {
        const current = await tx.orderTracker.findUnique({ where: { id: row.orderTrackerId }, select: { customerId: true } });
        if (!current || current.customerId !== row.customerId) conflict('The stable source tracker customer has changed.', 'PREPAYMENT_SOURCE_CONFLICT');
      }
      if (persist) {
        const { id, ...data } = row;
        row = id ? await tx.prepaymentSource.update({ where: { id }, data: { orderId: row.orderId } })
          : await tx.prepaymentSource.create({ data });
      }
      if (row.id) ref.binding = { type: 'LEDGER_SOURCE', id: row.id };
      else if (row.orderTrackerId) ref.binding = { type: 'LEDGER_TRACKER', id: row.orderTrackerId };
      else if (row.orderId) ref.binding = { type: 'LEDGER_ORDER', id: row.orderId };
      entries.push(row);
    }
    const keys = entries.map(row => row.id || row.orderTrackerId || row.orderId || `${row.customerId}:${row.normalizedOrderNo}`);
    if (new Set(keys).size !== keys.length) conflict('The same original source was supplied more than once.');
    sources.set(group.billingGroupId, entries);
  }
  return { snapshot, sources };
}

export const creditInclude = {
  funding: { include: { receipt: true } }, allocations: { where: { state: { in: ['APPLIED', 'RESERVED'] as string[] } } },
} as const;
export type CreditRow = Prisma.PrepaymentCreditGetPayload<{ include: typeof creditInclude }>;
export type Candidate = {
  creditId: string; receiptId: string; receiptNo: string | null; sourceOrderNo: string; originCustomerId: string;
  available: Prisma.Decimal; applied: Prisma.Decimal; reserved: Prisma.Decimal; totalApplied: Prisma.Decimal;
  fundingId: string | null; legacyReceiptId: string | null; sourceId: string | null; createdAt: Date;
};

export async function listGroupCandidates(tx: Tx, snapshot: FinancialSnapshot, group: FinancialSnapshot['customers'][number], sources: ResolvedSource[]) {
  const sourceIds = sources.flatMap(row => row.id ? [row.id] : []);
  const trackerIds = sources.flatMap(row => row.orderTrackerId ? [row.orderTrackerId] : []);
  const orderIds = sources.flatMap(row => row.orderId ? [row.orderId] : []);
  const linked = await tx.mucontInvoiceGroup.findUnique({ where: { invoiceBatchId_billingGroupId: { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId } } });
  const credits = await tx.prepaymentCredit.findMany({ where: { customerId: group.muledgerCustomerId,
    OR: [{ sourceId: { in: sourceIds } }, { orderTrackerId: { in: trackerIds } },
      { funding: { originalOrderId: { in: orderIds }, originalCustomerId: group.muledgerCustomerId }, sourceId: null, orderTrackerId: null },
      // A later receipt may pay a combined invoice rather than a single original
      // ORDER. Its immutable root records the verified source set at receipt time.
      ...sourceIds.map(id => ({ sourceId: null, orderTrackerId: null, funding: {
        originalCustomerId: group.muledgerCustomerId,
        receiptSnapshot: { path: '$.originSourceIds', array_contains: [id] },
      } })),
      { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId },
      { allocations: { some: { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId, state: 'APPLIED' } } }],
  }, include: creditInclude });
  const possibleOrders = [...new Set([...orderIds, ...(linked ? [linked.orderId] : [])])];
  const legacy = await tx.receipt.findMany({ where: { orderId: { in: possibleOrders }, funding: null,
    status: { not: 'SIGNING_PENDING' }, usd: { gt: 0 } }, include: { order: { include: { invoice: true } }, generatedByBalanceTransfer: true } });
  const receiptIds = [...credits.flatMap(row => row.funding.receiptId ? [row.funding.receiptId] : []), ...legacy.map(row => row.id)];
  const pending = new Set((await tx.deletionRequest.findMany({ where: { targetType: 'RECEIPT', status: 'PENDING', targetId: { in: receiptIds } }, select: { targetId: true } })).map(row => row.targetId));
  const candidates: Candidate[] = credits.map(row => {
    const applied = row.allocations.filter(a => a.state === 'APPLIED').reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
    const own = row.allocations.filter(a => a.state === 'APPLIED' && a.invoiceBatchId === snapshot.invoiceBatchId && a.billingGroupId === group.billingGroupId).reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
    const reserved = row.allocations.filter(a => a.state === 'RESERVED').reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
    const active = row.funding.active && row.funding.receipt && row.funding.receipt.status !== 'SIGNING_PENDING';
    const available = active && !pending.has(row.funding.originalReceiptId) ? row.amount.minus(applied).minus(reserved) : new Prisma.Decimal(0);
    if (available.isNegative()) conflict('Credit allocations exceed the real receipt.', 'PREPAYMENT_INTEGRITY_CONFLICT');
    return { creditId: row.id, receiptId: row.funding.originalReceiptId, receiptNo: row.funding.receipt?.receiptNo || null,
      sourceOrderNo: row.funding.receipt?.orderNo || '', originCustomerId: row.funding.originalCustomerId,
      available, applied: own, reserved, totalApplied: applied, fundingId: row.fundingId, legacyReceiptId: null, sourceId: row.sourceId,
      createdAt: row.funding.receipt?.createdAt || row.createdAt };
  });
  for (const receipt of legacy) {
    if (!receipt.order || receipt.generatedByBalanceTransfer || pending.has(receipt.id)) continue;
    if (receipt.customerId && receipt.customerId !== group.muledgerCustomerId) conflict('Receipt customer disagrees with its original ORDER.');
    if (receipt.order.customerId !== group.muledgerCustomerId) conflict('Receipt source ORDER customer changed.');
    const isTarget = linked?.orderId === receipt.orderId;
    const isPool = poolNames.includes(receipt.order.invoice.invNo) && receipt.order.amount.equals(0);
    if (!isTarget && !isPool) continue;
    const transfers = await tx.balanceTransfer.count({ where: { OR: [{ fromOrderId: receipt.order.id }, { toOrderId: receipt.order.id }] } });
    if (transfers) conflict('Legacy transfers require explicit reconciliation before enabling allocation.', 'PREPAYMENT_LEGACY_TRANSFER_CONFLICT');
    const source = sources.find(row => row.orderId === receipt.orderId);
    candidates.push({ creditId: `legacy:${receipt.id}`, receiptId: receipt.id, receiptNo: receipt.receiptNo,
      sourceOrderNo: receipt.orderNo || receipt.order.orderNo, originCustomerId: group.muledgerCustomerId,
      available: isTarget ? new Prisma.Decimal(0) : receipt.usd, applied: isTarget ? receipt.usd : new Prisma.Decimal(0),
      reserved: new Prisma.Decimal(0), totalApplied: isTarget ? receipt.usd : new Prisma.Decimal(0),
      fundingId: null, legacyReceiptId: receipt.id, sourceId: source?.id || null, createdAt: receipt.createdAt });
  }
  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.receiptId.localeCompare(b.receiptId) || a.creditId.localeCompare(b.creditId));
  return { candidates, linked };
}

export async function activateCandidate(tx: Tx, candidate: Candidate, group: FinancialSnapshot['customers'][number], batchId: string, targetOrderId: string | null) {
  if (!candidate.legacyReceiptId) return candidate;
  const receipt = await tx.receipt.findUniqueOrThrow({ where: { id: candidate.legacyReceiptId } });
  const funding = await tx.receiptFunding.create({ data: { receiptId: receipt.id, originalReceiptId: receipt.id,
    originalOrderId: receipt.orderId!, originalCustomerId: group.muledgerCustomerId, receivedAmount: receipt.usd,
    receiptSnapshot: { receiptId: receipt.id, receiptNo: receipt.receiptNo, usd: receipt.usd.toFixed(2),
      orderId: receipt.orderId, customerId: receipt.customerId, createdAt: receipt.createdAt.toISOString(), createdBy: receipt.createdBy } } });
  const credit = await tx.prepaymentCredit.create({ data: { fundingId: funding.id, customerId: group.muledgerCustomerId,
    sourceId: candidate.sourceId, amount: receipt.usd,
    ...(candidate.sourceId ? {} : { invoiceBatchId: batchId, billingGroupId: group.billingGroupId }) } });
  if (candidate.applied.gt(0)) await tx.prepaymentAllocation.create({ data: { fundingId: funding.id, creditId: credit.id,
    invoiceBatchId: batchId, billingGroupId: group.billingGroupId, orderId: targetOrderId,
    amount: candidate.applied, state: 'APPLIED', appliedAt: receipt.createdAt } });
  await tx.order.update({ where: { id: receipt.orderId! }, data: { paymentAllocationMode: true } });
  return { ...candidate, creditId: credit.id, fundingId: funding.id, legacyReceiptId: null };
}
