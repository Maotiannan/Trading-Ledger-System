import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { customerBusinessNames, customerBusinessSelect } from './customer-business-label';
import { buildCompositeOrderLookupCandidates, normalizeOrderIdentifier } from './order-name-kernel';

type Tx = Prisma.TransactionClient;
const include = {
  invoice: { select: { invNo: true } },
  customer: { select: { id: true, name: true, companyName: true, ...customerBusinessSelect } },
  mucontGroup: { select: { invoiceBatchId: true, billingGroupId: true, customerId: true } },
} satisfies Prisma.OrderInclude;
export type RepairRow = Prisma.OrderGetPayload<{ include: typeof include }> & {
  sourceNames: Array<{ generationId: string; value: string }>;
};
export type RepairEntry = {
  orderId: string; orderNo: string; invoiceId: string; invNo: string; customerId: string | null;
  oldValue: string | null; newValue: string | null;
  decision: 'KEEP' | 'REPAIR' | 'REVIEW'; reason: string;
  evidence: string[]; orderHash: string; customerHash: string;
};
export type RepairPlan = { schema: 'ORDER_BUSINESS_NAME_REPAIR_V1'; createdAt: string; rows: RepairEntry[] };

export function repairHash(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (item && typeof item === 'object' && 'toJSON' in item && typeof item.toJSON === 'function') return sorted(item.toJSON());
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
    return item;
  };
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}

export async function loadRepairRows(tx: Tx, ids?: string[]): Promise<RepairRow[]> {
  const orders = await tx.order.findMany({ where: ids ? { id: { in: ids } } : undefined, include, orderBy: { id: 'asc' } });
  const batches = [...new Set(orders.flatMap(order => order.mucontGroup ? [order.mucontGroup.invoiceBatchId] : []))];
  const generations = batches.length ? await tx.mucontInvoiceGeneration.findMany({
    where: { invoiceBatchId: { in: batches } }, select: { generationId: true, invoiceBatchId: true, snapshot: true }, orderBy: { generationId: 'asc' },
  }) : [];
  return orders.map(order => {
    const sourceNames: RepairRow['sourceNames'] = [];
    for (const generation of generations) {
      if (generation.invoiceBatchId !== order.mucontGroup?.invoiceBatchId) continue;
      const payload = generation.snapshot as Record<string, unknown>;
      const financial = (payload.schemaVersion === 2 ? payload.snapshot : payload) as Record<string, unknown> | undefined;
      const groups = Array.isArray(financial?.customers) ? financial.customers as Array<Record<string, unknown>> : [];
      const bound = groups.find(group => group.billingGroupId === order.mucontGroup?.billingGroupId && group.muledgerCustomerId === order.customerId);
      if (!bound) continue;
      const snapshots = Array.isArray(payload.customerSnapshots) ? payload.customerSnapshots as Array<Record<string, unknown>> : [];
      const snapshot = (payload.schemaVersion === 2
        ? snapshots.find(row => row.billingGroupId === bound.billingGroupId)?.customerSnapshot
        : bound.customerSnapshot) as { name?: unknown } | undefined;
      if (typeof snapshot?.name === 'string') sourceNames.push({ generationId: generation.generationId, value: snapshot.name });
    }
    return { ...order, sourceNames };
  });
}

export function classifyRepairRow(row: RepairRow): RepairEntry {
  const { customer, invoice, mucontGroup, sourceNames, ...order } = row;
  const entry: RepairEntry = {
    orderId: row.id, orderNo: row.orderNo, invoiceId: row.invoiceId, invNo: invoice.invNo,
    customerId: row.customerId, oldValue: row.customerName, newValue: null,
    decision: 'REVIEW', reason: 'MISSING_CUSTOMER_OR_BUSINESS_NAME', evidence: [],
    orderHash: repairHash(order), customerHash: repairHash({ customer, mucontGroup }),
  };
  if (!customer || customer.id !== row.customerId) return entry;
  if (mucontGroup && mucontGroup.customerId !== row.customerId) return { ...entry, reason: 'SOURCE_IDENTITY_MISMATCH' };
  const names = customerBusinessNames(customer);
  const old = normalizeOrderIdentifier(row.customerName);
  if (names.some(name => normalizeOrderIdentifier(name) === old)) return { ...entry, decision: 'KEEP', reason: 'REGISTERED_ALIAS' };
  if (!names.length) return entry;
  const evidence: string[] = [];
  if (old && old === normalizeOrderIdentifier(customer.name)) evidence.push('CUSTOMER_NAME');
  if (old && old === normalizeOrderIdentifier(customer.companyName)) evidence.push('CUSTOMER_COMPANY_NAME');
  for (const snapshot of [...sourceNames].sort((a, b) => a.generationId.localeCompare(b.generationId))) {
    if (old && old === normalizeOrderIdentifier(snapshot.value)) evidence.push(`SOURCE_SNAPSHOT:${snapshot.generationId}`);
  }
  if (!evidence.length) return { ...entry, reason: 'UNPROVEN_TEXT' };
  const candidates = new Set(buildCompositeOrderLookupCandidates(row.orderNo).orderNameCandidates.map(candidate => candidate.normalizedOrderName));
  const matched = names.filter(name => candidates.has(normalizeOrderIdentifier(name)));
  const newValue = names.length === 1 ? names[0] : matched.length === 1 ? matched[0] : null;
  if (!newValue) return { ...entry, evidence, reason: 'AMBIGUOUS_REGISTERED_ALIASES' };
  return { ...entry, decision: 'REPAIR', reason: 'DOCUMENT_NAME_IN_BUSINESS_FIELD', newValue, evidence };
}

export async function previewOrderBusinessNames(db: PrismaClient): Promise<RepairPlan> {
  // The CLI limits the pool to one connection, so this applies to the read transaction.
  await db.$executeRawUnsafe('SET SESSION TRANSACTION READ ONLY');
  return db.$transaction(async tx => {
    const flags = await tx.$queryRawUnsafe<Array<{ ro: number }>>('SELECT @@tx_read_only AS ro');
    if (Number(flags[0]?.ro) !== 1) throw new Error('Read-only transaction was not established');
    return { schema: 'ORDER_BUSINESS_NAME_REPAIR_V1', createdAt: new Date().toISOString(), rows: (await loadRepairRows(tx)).map(classifyRepairRow) };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}

export async function applyOrderBusinessNames(db: PrismaClient, plan: RepairPlan, options: {
  expectedHash: string; actorId: string; rollback?: boolean;
  backup: (before: { planHash: string; rollback: boolean; rows: Array<{ orderId: string; customerId: string | null; customerName: string | null }> }) => Promise<void>;
}) {
  const planHash = repairHash(plan);
  if (plan.schema !== 'ORDER_BUSINESS_NAME_REPAIR_V1' || planHash !== options.expectedHash) throw new Error('Unapproved or changed repair plan');
  const entries = plan.rows.filter(row => row.decision === 'REPAIR').sort((a, b) => a.orderId.localeCompare(b.orderId));
  if (new Set(entries.map(row => row.orderId)).size !== entries.length) throw new Error('Duplicate repair order');
  const action = options.rollback ? 'ORDER_BUSINESS_NAME_REPAIR_ROLLBACK' : 'ORDER_BUSINESS_NAME_REPAIR';
  return db.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: options.actorId }, select: { role: true, level: true, disabledAt: true } });
    if (!actor || actor.role !== 'ADMIN' || actor.level !== 1 || actor.disabledAt) throw new Error('An active level-1 administrator is required');
    for (const row of entries) await tx.$queryRawUnsafe('SELECT id FROM `Order` WHERE id = ? FOR UPDATE', row.orderId);
    for (const id of [...new Set(entries.map(row => row.customerId).filter((id): id is string => Boolean(id)))].sort()) {
      await tx.$queryRawUnsafe('SELECT id FROM Customer WHERE id = ? FOR UPDATE', id);
    }
    const current = new Map((await loadRepairRows(tx, entries.map(row => row.orderId))).map(row => [row.id, row]));
    const changes: Array<{ entry: RepairEntry; row: RepairRow; desired: string | null }> = [];
    for (const entry of entries) {
      const row = current.get(entry.orderId);
      if (!row) throw new Error(`Order disappeared: ${entry.orderId}`);
      const expected = classifyRepairRow({ ...row, customerName: entry.oldValue });
      if (repairHash(expected) !== repairHash(entry)) throw new Error(`Repair precondition changed: ${entry.orderId}`);
      const desired = options.rollback ? entry.oldValue : entry.newValue;
      const previous = options.rollback ? entry.newValue : entry.oldValue;
      const audits = await tx.auditLog.findMany({ where: { targetType: 'ORDER', targetId: row.id,
        action: { in: ['ORDER_BUSINESS_NAME_REPAIR', 'ORDER_BUSINESS_NAME_REPAIR_ROLLBACK'] } }, select: { action: true, metadata: true } });
      const hasAudit = (actionName: string) => audits.some(audit => audit.action === actionName && (audit.metadata as { planHash?: string })?.planHash === planHash);
      if (row.customerName === desired && hasAudit(action)) continue;
      if (row.customerName !== previous || (options.rollback && !hasAudit('ORDER_BUSINESS_NAME_REPAIR'))) throw new Error(`Unexpected current name: ${row.id}`);
      changes.push({ entry, row, desired });
    }
    if (changes.length) await options.backup({ planHash, rollback: Boolean(options.rollback), rows: changes.map(({ row }) => ({
      orderId: row.id, customerId: row.customerId, customerName: row.customerName,
    })) });
    for (const { entry, row, desired } of changes) {
      // This targeted correction preserves every other column, including updatedAt.
      const result = await tx.order.updateMany({ where: { id: row.id, customerId: entry.customerId,
        customerName: row.customerName, updatedAt: row.updatedAt }, data: { customerName: desired, updatedAt: row.updatedAt } });
      if (result.count !== 1) throw new Error(`Repair compare-and-swap failed: ${row.id}`);
      await tx.auditLog.create({ data: { action, actorId: options.actorId, targetType: 'ORDER', targetId: row.id,
        metadata: { planHash, customerId: row.customerId, orderNo: row.orderNo, before: row.customerName, after: desired,
          evidence: entry.evidence, orderHash: entry.orderHash, customerHash: entry.customerHash } } });
    }
    return { planHash, action, changed: changes.length, alreadyApplied: entries.length - changes.length };
  }, { isolationLevel: 'ReadCommitted', timeout: 30000 });
}
