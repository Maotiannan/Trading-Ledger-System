import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { runFinancialTransaction, type DbTransactionClient } from '@/lib/transaction';
import { lockOrderBalances } from '@/lib/order-balance-lock';
import { updateOrderBalance, calculateLiveOrderBalance } from '@/lib/order-balance-service';
import { authorizeAllocationWrite } from '@/lib/prepayments/write-context';
import { planFundingPools } from '@/lib/prepayments/service';
import type { FinancialSnapshot } from '@/lib/prepayments/contract';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { normalizeOrderNo, splitCompositeOrderNo } from '@/lib/order-alias';
import { serializeOrderTokens } from '@/lib/tokenizer';
import { buildInvoiceVisibilityWhere, buildOrderVisibilityWhere } from '@/lib/resource-visibility';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import type { CurrentUser } from '@/lib/request-auth';
import { customerBusinessSelect, customerOrderName } from '@/lib/customer-business-label';
import { renameInvoiceNumber, syncInvoiceNumberReferences, validateInvoiceNumber } from '@/lib/invoice-number';
import { invoiceConflict, invoicePayloadHash, MucontInvoiceError, parseInvoiceGeneration, type InvoiceGeneration } from './mucont-invoice-contract';
import { validateGroupChanges } from '@/lib/prepayments/group-cancellation';

type Tx = DbTransactionClient;
type CustomerGroup = InvoiceGeneration['customers'][number];
export const invoiceRevisionInclude = { orders: { orderBy: { id: 'asc' as const } }, mucontSource: true };
export function invoiceRevision(invoice: {
  id: string; invNo: string; createdBy: string; managedById?: string | null;
  orders: Array<{ id: string; orderNo: string; amount: unknown; customerId: string | null; createdBy: string | null; managedById?: string | null }>;
  mucontSource?: { publicationSequence: number; generationId: string | null } | null;
}) {
  // Source metadata reads and balance cache repairs must not cause false edit conflicts.
  return invoicePayloadHash({
    id: invoice.id, invNo: invoice.invNo, owner: invoice.managedById || invoice.createdBy,
    sequence: invoice.mucontSource?.publicationSequence, generation: invoice.mucontSource?.generationId,
    orders: [...invoice.orders].sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({
      id: row.id, orderNo: row.orderNo, amount: String(row.amount), customerId: row.customerId,
      owner: row.managedById || row.createdBy,
    })),
  });
}

export async function requireWholeInvoice(user: CurrentUser, invoiceId: string, write = false, tx: Tx = db) {
  if (write && user.role !== UserRole.ADMIN) throw new MucontInvoiceError(403, 'FORBIDDEN', 'Administrator permission required.');
  const scope = await getHierarchyScope(user, tx);
  const owners = [...scope.ownerVisibleIds];
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, ...buildInvoiceVisibilityWhere(owners, true) }, include: invoiceRevisionInclude,
  });
  if (!invoice) throw new MucontInvoiceError(404, 'INVOICE_NOT_FOUND', 'Invoice is not available.');
  const visible = await tx.order.count({ where: { invoiceId, ...buildOrderVisibilityWhere(owners, true) } });
  if (visible !== invoice.orders.length) throw new MucontInvoiceError(403, 'PARTIAL_INVOICE_SCOPE', 'Full invoice access is required.');
  return invoice;
}

function displayOrder(group: CustomerGroup) {
  const value = [...new Set(group.orderRefs.map((row) => row.displayOrderNo))].join('/');
  if (value.length > 191) invoiceConflict('Combined ORDER NO exceeds the current ledger field limit (191).');
  return value;
}
function groupAliases(group: CustomerGroup) {
  // Original source numbers may be shared by later shipments. Only shipment
  // display references can occupy the ledger's globally unique alias space.
  return [...new Set(group.orderRefs.flatMap((row) => splitCompositeOrderNo(row.displayOrderNo)).map(normalizeOrderNo))];
}
async function writeAliases(tx: Tx, orderId: string, aliases: string[], fundingPools: string[] = []) {
  const occupiedOrder = await tx.order.findFirst({ where: { canceledAt: null, id: { notIn: [orderId, ...fundingPools] }, orderNo: { in: aliases } } });
  if (occupiedOrder) invoiceConflict('A displayed ORDER NO is already used by another financial order.');
  if (fundingPools.length) await tx.orderAlias.deleteMany({ where: { orderId: { in: fundingPools }, aliasNo: { in: aliases } } });
  const occupied = await tx.orderAlias.findFirst({ where: { aliasNo: { in: aliases }, orderId: { not: orderId } } });
  if (occupied) invoiceConflict('An ORDER NO alias is already linked to a different financial order.');
  await tx.orderAlias.deleteMany({ where: { orderId } });
  await tx.orderAlias.createMany({ data: [...new Set(aliases)].map((aliasNo) => ({ aliasNo, orderId })) });
}
async function serviceActor(tx: Tx) {
  const id = process.env.MUCONT_INVOICE_ACTOR_ID;
  const actor = id ? await tx.user.findFirst({ where: { id, role: 'ADMIN', disabledAt: null } }) : null;
  if (!actor) throw new MucontInvoiceError(503, 'SERVICE_ACTOR_UNAVAILABLE', 'An active invoice integration administrator must be configured.');
  return actor;
}

async function planSnapshot(tx: Tx, snapshot: InvoiceGeneration, allowedFundingPools?: string[], replayRemoval = false) {
  const allowFundingPools = allowedFundingPools !== undefined;
  const source = await tx.mucontInvoiceSource.findUnique({
    where: { invoiceBatchId: snapshot.invoiceBatchId }, include: { groups: true },
  }) || { invoiceId: null, groups: [] };
  const customerIds = [...new Set(snapshot.customers.map((row) => row.muledgerCustomerId))];
  const customers = await tx.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, ...customerBusinessSelect } });
  if (customers.length !== customerIds.length) invoiceConflict('One or more stable customer bindings are missing.');
  await validateGroupChanges(tx, replayRemoval ? { ...snapshot, groupChanges: undefined } : snapshot);
  const invoice = source.invoiceId
    ? await tx.invoice.findUniqueOrThrow({ where: { id: source.invoiceId }, include: invoiceRevisionInclude })
    : await tx.invoice.findUnique({ where: { invNo: snapshot.invoiceNo }, include: invoiceRevisionInclude });
  if (invoice?.mucontSource && invoice.mucontSource.invoiceBatchId !== snapshot.invoiceBatchId) {
    invoiceConflict('This invoice is already linked to another source batch.');
  }
  const matching = new Map<string, string>();
  const existingOrders = invoice?.orders || [];
  const candidateSnapshots = [...existingOrders];
  const fundingPools: string[] = [...(allowedFundingPools || [])];
  if (!allowFundingPools && existingOrders.some(order => order.paymentAllocationMode)) invoiceConflict('This invoice uses V2 payment allocation. Use the V2 financial plan.');
  for (const group of snapshot.customers) {
    const linked = source.groups.find((row) => row.billingGroupId === group.billingGroupId);
    if (linked) {
      if (linked.customerId !== group.muledgerCustomerId) invoiceConflict('The customer identity of a linked billing group changed.');
      const order = existingOrders.find((row) => row.id === linked.orderId);
      if (!order || order.customerId !== group.muledgerCustomerId) invoiceConflict('A linked financial order was moved or its customer was changed.');
      matching.set(group.billingGroupId, linked.orderId);
      continue;
    }
    const candidates = existingOrders.filter((row) => row.customerId === group.muledgerCustomerId
      && normalizeOrderNo(row.orderNo) === normalizeOrderNo(displayOrder(group))
      && row.amount.equals(group.totalAmount));
    if (!source.invoiceId && invoice) {
      if (candidates.length !== 1) invoiceConflict('Historical invoice is not an exact unique identity/amount match.');
      matching.set(group.billingGroupId, candidates[0].id);
    }
  }
  if (!source.invoiceId && invoice && (matching.size !== existingOrders.length || new Set(matching.values()).size !== matching.size)) {
    invoiceConflict('Historical invoice contains split, extra or ambiguous customer orders.');
  }
  if (source.invoiceId && existingOrders.some((row) => !source.groups.some((group) => group.orderId === row.id))) {
    invoiceConflict('Invoice structure no longer matches its stable source groups.');
  }
  // Exact pool adoption only. Never infer shipment suffixes or merge two receipts/orders.
  for (const group of snapshot.customers) {
    if (matching.has(group.billingGroupId)) continue;
    const aliases = groupAliases(group);
    const rows = await tx.order.findMany({
      where: { canceledAt: null, OR: [{ orderNo: { in: [...aliases, displayOrder(group)] } }, { aliases: { some: { aliasNo: { in: aliases } } } }] },
      include: { invoice: true, mucontGroup: true },
    });
    if (rows.length) {
      const row = rows[0];
      if (!allowFundingPools && rows.some(item => item.paymentAllocationMode)) invoiceConflict('This ORDER uses V2 payment allocation.');
      const managedPools = allowFundingPools && rows.every(item => allowedFundingPools?.includes(item.id) && !item.mucontGroup
        && ['DEPOSIT_POOL', 'Un_Associated'].includes(item.invoice.invNo) && item.amount.equals(0) && item.customerId === group.muledgerCustomerId);
      if (managedPools) {
        const unallocated = await tx.receipt.count({ where: { orderId: { in: rows.map(item => item.id) },
          status: { not: 'SIGNING_PENDING' }, funding: null } });
        if (unallocated) invoiceConflict('Some pool receipts have not been reconciled into the payment plan.');
        candidateSnapshots.push(...rows);
        if (rows.length === 1 && normalizeOrderNo(row.orderNo) === normalizeOrderNo(displayOrder(group))) matching.set(group.billingGroupId, row.id);
        continue;
      }
      if (rows.length !== 1 || row.mucontGroup || !['DEPOSIT_POOL', 'Un_Associated'].includes(row.invoice.invNo)
        || row.customerId !== group.muledgerCustomerId || !row.amount.equals(0)
        || normalizeOrderNo(row.orderNo) !== normalizeOrderNo(displayOrder(group))) {
        invoiceConflict('Existing ORDER NO requires explicit financial reconciliation.');
      }
      matching.set(group.billingGroupId, row.id);
      candidateSnapshots.push(row);
    }
  }
  if (new Set(matching.values()).size !== matching.size) invoiceConflict('Multiple source groups cannot consume the same financial order.');
  return { invoice, matching, candidateSnapshots, fundingPools, customers: new Map(customers.map(customer => [customer.id, customer])) };
}

export async function previewInvoiceGeneration(user: CurrentUser, input: unknown, tx: Tx = db,
  funding?: { rawInput: unknown; fundingPools: string[] }) {
  if (user.role !== 'ADMIN') throw new MucontInvoiceError(403, 'FORBIDDEN', 'Administrator permission required.');
  const snapshot = parseInvoiceGeneration(input);
  const scope = await getHierarchyScope(user, tx);
  const customers = await tx.customer.count({ where: { id: { in: [...new Set(snapshot.customers.map((row) => row.muledgerCustomerId))] },
    ownerId: { in: [...scope.ownerVisibleIds] } } });
  if (customers !== new Set(snapshot.customers.map((row) => row.muledgerCustomerId)).size) {
    throw new MucontInvoiceError(403, 'CUSTOMER_SCOPE_FORBIDDEN', 'All source customers must be in your managed scope.');
  }
  const previous = await tx.mucontInvoiceGeneration.findUnique({ where: { generationId: snapshot.generationId }, include: { source: true } });
  if (previous) {
    if (previous.payloadHash !== invoicePayloadHash(funding?.rawInput || snapshot)) invoiceConflict('Generation ID payload mismatch.');
    if (previous.source.invoiceId) await requireWholeInvoice(user, previous.source.invoiceId, true, tx);
    return { generationId: snapshot.generationId, invoiceBatchId: snapshot.invoiceBatchId, result: 'ALREADY_PROCESSED', payloadHash: previous.payloadHash };
  }
  const plan = await planSnapshot(tx, snapshot, funding?.fundingPools);
  if (plan.invoice) await requireWholeInvoice(user, plan.invoice.id, true, tx);
  return { generationId: snapshot.generationId, invoiceBatchId: snapshot.invoiceBatchId, invoiceNo: snapshot.invoiceNo,
    result: 'READY', payloadHash: invoicePayloadHash(funding?.rawInput || snapshot), ledgerInvoiceId: plan.invoice?.id || null,
    existingOrderIds: [...plan.matching.values()], createGroups: snapshot.customers.length - plan.matching.size, invoiceTotal: snapshot.invoiceTotal,
    maxOrderDisplayLength: Math.max(...snapshot.customers.map((row) => row.orderRefs.map((ref) => ref.displayOrderNo).join('/').length)) };
}

async function applySnapshot(tx: Tx, snapshot: InvoiceGeneration, actorId: string, allowedFundingPools?: string[], replayRemoval = false) {
  const initial = await planSnapshot(tx, snapshot, allowedFundingPools, replayRemoval);
  const lockedIds = initial.candidateSnapshots.map((row) => row.id).sort();
  await lockOrderBalances(tx, lockedIds);
  // Receipts may update balance/updatedAt while we acquire the order locks.
  // Revalidate the actual financial structure instead of rejecting a valid payment.
  const plan = await planSnapshot(tx, snapshot, allowedFundingPools, replayRemoval);
  if (JSON.stringify(lockedIds) !== JSON.stringify(plan.candidateSnapshots.map((row) => row.id).sort())) {
    invoiceConflict('Invoice structure changed. Retry after refreshing.');
  }
  const { matching } = plan;
  let invoice = plan.invoice;
  if (invoice) {
    const collision = await tx.invoice.findFirst({ where: { invNo: snapshot.invoiceNo, id: { not: invoice.id } } });
    if (collision) invoiceConflict('Invoice number is already occupied.');
    invoice = await tx.invoice.update({ where: { id: invoice.id }, data: { invNo: snapshot.invoiceNo,
      canceledAt: snapshot.groupChanges?.cancelInvoice ? invoice.canceledAt || new Date() : null }, include: invoiceRevisionInclude });
  } else {
    invoice = await tx.invoice.create({ data: { invNo: snapshot.invoiceNo, createdBy: actorId }, include: invoiceRevisionInclude });
  }
  const changes: unknown[] = [];
  for (const group of snapshot.customers) {
    const orderId = matching.get(group.billingGroupId);
    const before = orderId ? await tx.order.findUniqueOrThrow({ where: { id: orderId } }) : null;
    const data = {
      invoiceId: invoice.id, orderNo: displayOrder(group), tokens: serializeOrderTokens(displayOrder(group)),
      canceledAt: null,
      amount: new Prisma.Decimal(group.totalAmount), customerId: group.muledgerCustomerId,
      customerMark: group.customerSnapshot.mark, customerName: customerOrderName(plan.customers.get(group.muledgerCustomerId)!, before?.customerName),
      customerPhone: group.customerSnapshot.phone, customerCity: group.customerSnapshot.city, needsCustomerFix: false,
    };
    const order = before ? await tx.order.update({ where: { id: before.id }, data })
      : await tx.order.create({ data: { ...data, createdBy: invoice.createdBy, managedById: invoice.managedById } });
    await writeAliases(tx, order.id, groupAliases(group), plan.fundingPools);
    const balance = await updateOrderBalance(order.id, tx, { actorId, source: 'MUCONT_INVOICE_GENERATION' });
    await tx.mucontInvoiceGroup.upsert({
      where: { invoiceBatchId_billingGroupId: { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId } },
      create: { invoiceBatchId: snapshot.invoiceBatchId, billingGroupId: group.billingGroupId, orderId: order.id, customerId: group.muledgerCustomerId, orderRefs: group.orderRefs },
      update: { orderRefs: group.orderRefs },
    });
    changes.push({ orderId: order.id, before: before ? { amount: String(before.amount), orderNo: before.orderNo, invoiceId: before.invoiceId } : null,
      after: { amount: group.totalAmount, orderNo: order.orderNo, balance: balance.computed } });
  }
  if (plan.invoice && plan.invoice.invNo !== snapshot.invoiceNo) {
    await syncInvoiceNumberReferences(tx, invoice.id, snapshot.invoiceNo);
  }
  await tx.mucontInvoiceSource.update({ where: { invoiceBatchId: snapshot.invoiceBatchId }, data: {
    invoiceId: invoice.id, generationId: snapshot.generationId, publicationSequence: snapshot.publicationSequence,
    documentVersion: snapshot.documentVersion, appliedAt: new Date(),
  } });
  await recordAuditEventInTransaction(tx, { action: 'MUCONT_INVOICE_APPLY', actorId, targetType: 'INVOICE', targetId: invoice.id,
    metadata: { generationId: snapshot.generationId, invoiceBatchId: snapshot.invoiceBatchId, publicationSequence: snapshot.publicationSequence, changes,
      ...(plan.fundingPools.length ? { fundingPoolAliasesMoved: plan.fundingPools } : {}) } });
  return invoice.id;
}

export type ManualIntent = { requestId: string; expectedRevision: string; invoiceId: string; user: CurrentUser };
export type InvoiceFundingHooks = {
  rawInput: unknown;
  formatResponse: (response: Record<string, unknown>) => Record<string, unknown>;
  beforeApply: (tx: Tx, actorId: string) => Promise<string[]>;
  afterApply: (tx: Tx, invoiceId: string, actorId: string) => Promise<void>;
};
export async function acceptInvoiceGeneration(input: unknown, manual?: ManualIntent, historyUser?: CurrentUser, funding?: InvoiceFundingHooks) {
  const snapshot = parseInvoiceGeneration(input);
  if (snapshot.groupChanges && !funding) invoiceConflict('Group cancellation requires the V2 financial plan.');
  const hash = invoicePayloadHash(funding?.rawInput || snapshot);
  for (let attempt = 0; ; attempt++) {
    try {
      return await runFinancialTransaction(async (tx) => {
        const actor = manual?.user || await serviceActor(tx);
        await tx.mucontInvoiceSource.upsert({ where: { invoiceBatchId: snapshot.invoiceBatchId },
          create: { invoiceBatchId: snapshot.invoiceBatchId }, update: {} });
        await tx.$queryRaw`SELECT invoiceBatchId FROM MucontInvoiceSource WHERE invoiceBatchId = ${snapshot.invoiceBatchId} FOR UPDATE`;
        const source = await tx.mucontInvoiceSource.findUniqueOrThrow({ where: { invoiceBatchId: snapshot.invoiceBatchId } });
        const previous = await tx.mucontInvoiceGeneration.findUnique({ where: { generationId: snapshot.generationId } });
        if (previous && previous.payloadHash !== hash) invoiceConflict('Generation ID was reused with a different payload.');
        if (historyUser) await previewInvoiceGeneration(historyUser, snapshot, tx,
          funding ? { rawInput: funding.rawInput, fundingPools: previous ? [] : await funding.beforeApply(tx, actor.id) } : undefined);
        if (manual) {
          const previous = await tx.mucontInvoiceResync.findUnique({ where: { requestId: manual.requestId } });
          if (previous) {
            if (previous.actorId !== actor.id || previous.invoiceBatchId !== snapshot.invoiceBatchId || previous.expectedRevision !== manual.expectedRevision) invoiceConflict('Request ID was already used for another intent.');
            return previous.result;
          }
          if (source.invoiceId !== manual.invoiceId) invoiceConflict('Source invoice identity changed.');
          const view = await requireWholeInvoice(manual.user, manual.invoiceId, true, tx);
          await lockOrderBalances(tx, view.orders.map((row) => row.id));
          const current = await requireWholeInvoice(manual.user, manual.invoiceId, true, tx);
          if (invoiceRevision(current) !== manual.expectedRevision) invoiceConflict('Invoice changed. Refresh before synchronizing.');
        }
        if (snapshot.groupChanges && !previous && (snapshot.documentVersion < source.documentVersion || snapshot.publicationSequence <= source.publicationSequence
          || snapshot.groupChanges.expectedPublicationSequence !== source.publicationSequence)) invoiceConflict('Group cancellation publication version changed. Refresh before submitting.');
        const sequence = await tx.mucontInvoiceGeneration.findUnique({ where: {
          invoiceBatchId_publicationSequence: { invoiceBatchId: snapshot.invoiceBatchId, publicationSequence: snapshot.publicationSequence },
        } });
        if (sequence && sequence.generationId !== snapshot.generationId) invoiceConflict('Publication sequence was reused.');
        let result: 'APPLIED' | 'DUPLICATE' | 'IGNORED_STALE' = previous && !manual ? 'DUPLICATE'
          : snapshot.publicationSequence < source.publicationSequence ? 'IGNORED_STALE' : 'APPLIED';
        if (manual && result === 'IGNORED_STALE') invoiceConflict('Latest-generated response is older than the applied generation.');
        if (result === 'APPLIED' && snapshot.documentVersion < source.documentVersion) result = 'IGNORED_STALE';
        const fundingPools = result === 'APPLIED' && funding ? await funding.beforeApply(tx, actor.id) : undefined;
        const ledgerInvoiceId = result === 'APPLIED' ? await applySnapshot(tx, snapshot, actor.id, fundingPools, Boolean(previous && manual)) : source.invoiceId;
        if (result === 'APPLIED' && funding && ledgerInvoiceId) await funding.afterApply(tx, ledgerInvoiceId, actor.id);
        if (!previous) await tx.mucontInvoiceGeneration.create({ data: {
          generationId: snapshot.generationId, invoiceBatchId: snapshot.invoiceBatchId, publicationSequence: snapshot.publicationSequence,
            payloadHash: hash, snapshot: (funding?.rawInput || snapshot) as Prisma.InputJsonValue, result,
        } });
        const response = { schemaVersion: 1, generationId: snapshot.generationId, invoiceBatchId: snapshot.invoiceBatchId,
          publicationSequence: snapshot.publicationSequence, result, ledgerInvoiceId };
        if (manual) {
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: manual.invoiceId }, include: invoiceRevisionInclude });
          const output = { ...(funding ? funding.formatResponse(response) : response), revision: invoiceRevision(invoice) };
          await tx.mucontInvoiceResync.create({ data: { requestId: manual.requestId, invoiceBatchId: snapshot.invoiceBatchId,
            actorId: actor.id, expectedRevision: manual.expectedRevision, generationId: snapshot.generationId, result: output } });
          await recordAuditEventInTransaction(tx, { action: 'MUCONT_INVOICE_RESYNC', actorId: actor.id, targetType: 'INVOICE',
            targetId: manual.invoiceId, metadata: { requestId: manual.requestId, ...output } });
          return output;
        }
        return response;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (attempt < 1) continue;
        invoiceConflict('A financial identity or invoice number is already occupied.');
      }
      throw error;
    }
  }
}

export async function editSourceInvoiceOrder(user: CurrentUser, payload: {
  orderId: string; invNo?: string; orderNo?: string; amount?: number; customerId?: string | null;
  customerMark?: string | null; customerName?: string | null; customerPhone?: string | null; customerCity?: string | null;
}) {
  const link = await db.mucontInvoiceGroup.findUnique({ where: { orderId: payload.orderId }, include: { source: true } });
  if (!link) return null;
  return runFinancialTransaction(async (tx) => {
    await tx.$queryRaw`SELECT invoiceBatchId FROM MucontInvoiceSource WHERE invoiceBatchId = ${link.invoiceBatchId} FOR UPDATE`;
    const currentLink = await tx.mucontInvoiceGroup.findUnique({ where: { orderId: payload.orderId }, include: { source: true } });
    if (!currentLink || currentLink.invoiceBatchId !== link.invoiceBatchId || currentLink.source.invoiceId !== link.source.invoiceId) {
      invoiceConflict('Source identity changed. Refresh before editing.');
    }
    const invoice = await requireWholeInvoice(user, currentLink.source.invoiceId!, true, tx);
    await lockOrderBalances(tx, invoice.orders.map((row) => row.id));
    const before = await tx.order.findUniqueOrThrow({ where: { id: payload.orderId } });
    if (payload.customerId !== undefined && payload.customerId !== before.customerId) invoiceConflict('Changing a source group customer requires explicit reconciliation.');
    for (const field of ['customerMark', 'customerName', 'customerPhone', 'customerCity'] as const) {
      if (payload[field] !== undefined && (payload[field] ?? '').trim() !== (before[field] ?? '').trim()) {
        invoiceConflict('Customer details on a source invoice are read-only. Use Customer Management.');
      }
    }
    const orderNo = payload.orderNo?.trim() || before.orderNo;
    if (orderNo.length > 191 || (payload.amount !== undefined && (!Number.isFinite(payload.amount) || payload.amount < 0))) {
      throw new MucontInvoiceError(422, 'INVALID_ORDER', 'Invalid ORDER NO or amount.');
    }
    const invNo = payload.invNo === undefined ? invoice.invNo : payload.invNo.trim();
    let fundingPools: string[] = [];
    if (before.paymentAllocationMode) {
      if (await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: link.invoiceBatchId, state: 'RESERVED' } })) {
        invoiceConflict('Complete or cancel the pending invoice generation before editing locally.');
      }
      const paid = before.amount.minus(await calculateLiveOrderBalance(before.id, tx));
      if (new Prisma.Decimal(payload.amount ?? before.amount).lt(paid)) invoiceConflict('Receivable cannot be reduced below the amount already paid.');
      const plan = await tx.prepaymentPlan.findFirst({ where: { invoiceBatchId: link.invoiceBatchId, state: 'APPLIED' }, orderBy: { version: 'desc' } });
      if (plan) fundingPools = await planFundingPools(tx, plan.snapshot as unknown as FinancialSnapshot);
      authorizeAllocationWrite(tx);
    }
    validateInvoiceNumber(invNo);
    const data = await tx.order.update({ where: { id: before.id }, data: {
      orderNo, tokens: serializeOrderTokens(orderNo), amount: payload.amount ?? before.amount,
    } });
    const refs = currentLink.orderRefs as Array<{ sourceOrderNo: string; displayOrderNo: string }>;
    await writeAliases(tx, before.id, [...new Set([...splitCompositeOrderNo(orderNo),
      ...refs.flatMap((row) => splitCompositeOrderNo(row.displayOrderNo))].map(normalizeOrderNo))], fundingPools);
    await updateOrderBalance(before.id, tx, { actorId: user.id, source: 'MUCONT_INVOICE_LOCAL_EDIT' });
    await renameInvoiceNumber(tx, invoice, invNo);
    await recordAuditEventInTransaction(tx, { action: 'MUCONT_INVOICE_LOCAL_EDIT', actorId: user.id, targetType: 'INVOICE', targetId: invoice.id,
      metadata: { orderId: before.id, before: { invNo: invoice.invNo, orderNo: before.orderNo, amount: String(before.amount) },
        after: { invNo, orderNo, amount: String(data.amount) } } });
    return { data, message: 'Source invoice updated locally; receipts are unchanged.' };
  });
}
