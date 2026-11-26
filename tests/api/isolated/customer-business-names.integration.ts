/** @jest-environment node */
import { db } from '@/lib/db';
import { applyOrderBusinessNames, classifyRepairRow, loadRepairRows, previewOrderBusinessNames, repairHash, type RepairPlan } from '@/lib/order-business-name-repair';
import { acceptInvoiceGeneration, editSourceInvoiceOrder } from '@/lib/integrations/mucont-invoice-service';
import { acceptPrepaymentGeneration } from '@/lib/prepayments/generation';
import { previewPrepayments, reservePrepayments } from '@/lib/prepayments/service';
import type { CurrentUser } from '@/lib/request-auth';

const expected = 'mysql://root:names-isolated-only@127.0.0.1:13369/muledger_names_test?connection_limit=1';
if (process.env.DATABASE_URL !== expected) throw new Error('Refusing a non-isolated database');
const actor = 'names-test-admin';
const invoiceId = 'names-test-invoice';
let plan: RepairPlan;
const backup = jest.fn(async () => undefined);
const opts = () => ({ expectedHash: repairHash(plan), actorId: actor, backup });
const protectedRows = async () => repairHash({ receipts: await db.receipt.findMany({ orderBy: { id: 'asc' } }),
  sessions: await db.receiptGeneratorSession.findMany({ orderBy: { id: 'asc' } }),
  source: await db.mucontInvoiceGeneration.findMany({ orderBy: { generationId: 'asc' } }) });
const makePlan = async (): Promise<RepairPlan> => ({ schema: 'ORDER_BUSINESS_NAME_REPAIR_V1', createdAt: new Date().toISOString(),
  rows: (await loadRepairRows(db, ['repair-a', 'repair-b'])).map(classifyRepairRow) });

beforeAll(async () => {
  process.env.MUCONT_INVOICE_ACTOR_ID = actor;
  await db.user.create({ data: { id: actor, email: 'names-test@example.test', password: 'not-a-login-hash', role: 'ADMIN', level: 1 } });
  await db.invoice.create({ data: { id: invoiceId, invNo: 'NAMES-TEST', createdBy: actor } });
  for (const [suffix, old] of [['a', 'Actual Person'], ['b', 'Actual Company']]) {
    await db.customer.create({ data: { id: `customer-${suffix}`, orderName: `BIZ${suffix}`, mark: `MARK${suffix}`, normalizedMark: `mark${suffix}`,
      name: 'Actual Person', companyName: 'Actual Company', phone: '', city: '', createdBy: actor, ownerId: actor } });
    await db.order.create({ data: { id: `repair-${suffix}`, invoiceId, orderNo: `BIZ${suffix}-01`, amount: 100, orderBalance: 75,
      customerId: `customer-${suffix}`, customerName: old, createdBy: actor } });
    await db.receipt.create({ data: { id: `receipt-${suffix}`, orderId: `repair-${suffix}`, customerId: `customer-${suffix}`, usd: 25,
      payer: 'Explicit Legal Payer', customerName: 'Legal Person', status: 'RECEIVED', createdBy: actor } });
    await db.receiptGeneratorSession.create({ data: { receiptId: `receipt-${suffix}`, receiptNo: `TEST-${suffix}`, orderNo: `BIZ${suffix}-01`,
      customerId: `customer-${suffix}`, customerName: 'Legal Person', usd: 25, status: 'FINALIZED', createdBy: actor,
      layoutSnapshot: { clientName: 'Explicit Legal Payer', customerName: 'Legal Person' } } });
  }
  plan = await makePlan();
});
afterAll(async () => { await db.$disconnect(); });

it('creates a database-enforced read-only preview', async () => {
  try {
    const preview = await previewOrderBusinessNames(db);
    expect(preview.rows.filter(row => row.decision === 'REPAIR')).toHaveLength(2);
    await expect(db.order.update({ where: { id: 'repair-a' }, data: { customerName: 'forbidden' } })).rejects.toThrow();
  } finally { await db.$executeRawUnsafe('SET SESSION TRANSACTION READ WRITE'); }
});

it('applies once, repeats without writes, rolls back once and repeats rollback without writes', async () => {
  const before = await db.order.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } });
  const protectedBefore = await protectedRows();
  expect(await applyOrderBusinessNames(db, plan, opts())).toMatchObject({ changed: 2 });
  const after = await db.order.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } });
  expect(after.map(({ customerName: _name, ...row }) => row)).toEqual(before.map(({ customerName: _name, ...row }) => row));
  expect(after.map(row => row.customerName)).toEqual(['BIZa', 'BIZb']);
  expect(await protectedRows()).toBe(protectedBefore);
  expect(await applyOrderBusinessNames(db, plan, opts())).toMatchObject({ changed: 0, alreadyApplied: 2 });
  expect(backup).toHaveBeenCalledTimes(1);
  expect(await db.auditLog.count({ where: { action: 'ORDER_BUSINESS_NAME_REPAIR' } })).toBe(2);
  expect(await applyOrderBusinessNames(db, plan, { ...opts(), rollback: true })).toMatchObject({ changed: 2 });
  expect(await applyOrderBusinessNames(db, plan, { ...opts(), rollback: true })).toMatchObject({ changed: 0, alreadyApplied: 2 });
  expect(await db.order.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } })).toEqual(before);
  expect(await protectedRows()).toBe(protectedBefore);
});

it('rejects a changed order precondition before any batch write', async () => {
  const row = await db.order.findUniqueOrThrow({ where: { id: 'repair-b' } });
  await db.order.update({ where: { id: row.id }, data: { amount: 101 } });
  const auditCount = await db.auditLog.count();
  await expect(applyOrderBusinessNames(db, plan, opts())).rejects.toThrow('precondition changed');
  expect((await db.order.findUniqueOrThrow({ where: { id: 'repair-a' } })).customerName).toBe('Actual Person');
  expect(await db.auditLog.count()).toBe(auditCount);
  await db.order.update({ where: { id: row.id }, data: { amount: row.amount, updatedAt: row.updatedAt } });
});

it('rejects changed customer mapping and an unapproved plan', async () => {
  await db.customer.update({ where: { id: 'customer-b' }, data: { orderName: 'DIFFERENT' } });
  await expect(applyOrderBusinessNames(db, plan, opts())).rejects.toThrow('precondition changed');
  await db.customer.update({ where: { id: 'customer-b' }, data: { orderName: 'BIZb' } });
  await expect(applyOrderBusinessNames(db, plan, { ...opts(), expectedHash: 'wrong' })).rejects.toThrow('Unapproved');
});

it('rolls back all updates when the second transactional audit fails', async () => {
  const before = await db.order.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } });
  const count = await db.auditLog.count();
  await db.$executeRawUnsafe("CREATE TRIGGER reject_name_audit BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.targetId = 'repair-b' AND NEW.action = 'ORDER_BUSINESS_NAME_REPAIR' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated audit failure'; END IF; END");
  try { await expect(applyOrderBusinessNames(db, plan, opts())).rejects.toThrow(); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER reject_name_audit'); }
  expect(await db.order.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } })).toEqual(before);
  expect(await db.auditLog.count()).toBe(count);
});

it('requires an active top-level administrator and a successful preimage backup', async () => {
  await expect(applyOrderBusinessNames(db, plan, { ...opts(), actorId: 'missing' })).rejects.toThrow('administrator');
  await expect(applyOrderBusinessNames(db, plan, { ...opts(), backup: async () => { throw new Error('backup failed'); } })).rejects.toThrow('backup failed');
  expect((await db.order.findUniqueOrThrow({ where: { id: 'repair-a' } })).customerName).toBe('Actual Person');
});

it('V1 stores business names and preserves payload/hash/replay and local amount-edit identity', async () => {
  const payload = { schemaVersion: 1, source: 'MUCONT', generationId: 'test-v1-gen', invoiceBatchId: 'test-v1-batch', publicationSequence: 1,
    generatedAt: '2026-11-16T00:00:00.000Z', documentVersion: 1, invoiceNo: 'TEST-V1', currency: 'USD', invoiceTotal: '100.00',
    customers: [{ billingGroupId: 'test-v1-group', muledgerCustomerId: 'customer-a',
      customerSnapshot: { name: 'Invoice Legal Name', mark: 'Document Mark', phone: null, city: null },
      orderRefs: [{ sourceOrderNo: 'BIZa-V1', displayOrderNo: 'BIZa-V1' }], goodsAmount: '100.00', freightAmount: '0.00', adjustmentAmount: '0.00', totalAmount: '100.00' }] };
  const result = await acceptInvoiceGeneration(payload);
  expect(result).toMatchObject({ result: 'APPLIED' });
  const order = await db.order.findFirstOrThrow({ where: { orderNo: 'BIZa-V1' } });
  expect(order).toMatchObject({ customerId: 'customer-a', customerName: 'BIZa' });
  const stored = await db.mucontInvoiceGeneration.findUniqueOrThrow({ where: { generationId: payload.generationId } });
  expect(stored.snapshot).toEqual(payload);
  expect(stored.payloadHash).toBe(repairHash(payload));
  expect(await acceptInvoiceGeneration(payload)).toMatchObject({ result: 'DUPLICATE' });
  await editSourceInvoiceOrder({ id: actor, role: 'ADMIN', level: 1 } as CurrentUser, { orderId: order.id, amount: 120 });
  expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ customerId: 'customer-a', customerName: 'BIZa' });
});

it('V2 retains its financial plan and document snapshot while using a business order name', async () => {
  const pool = await db.invoice.create({ data: { invNo: 'DEPOSIT_POOL', createdBy: actor } });
  const order = await db.order.create({ data: { invoiceId: pool.id, orderNo: 'BIZb-V2', customerId: 'customer-b', customerName: 'Actual Company', amount: 0, createdBy: actor } });
  const snapshot = { invoiceBatchId: 'test-v2-batch', invoiceNo: 'TEST-V2', currency: 'USD', invoiceTotal: '250.00',
    customers: [{ billingGroupId: 'test-v2-group', muledgerCustomerId: 'customer-b',
      orderRefs: [{ binding: { type: 'LEDGER_ORDER', id: order.id }, sourceOrderNo: order.orderNo, displayOrderNo: order.orderNo }],
      goodsAmount: '250.00', adjustmentAmount: '0.00', freightAmount: '0.00', totalAmount: '250.00' }] };
  const preview = await previewPrepayments({ schemaVersion: 2, snapshot });
  const reserved = await reservePrepayments({ schemaVersion: 2, requestId: 'test-v2-reserve', mode: 'RECALCULATE',
    snapshot: preview.snapshot, expectedRevision: preview.revision, previousPlan: null });
  const payload = { schemaVersion: 2, source: 'MUCONT', generationId: 'test-v2-gen', publicationSequence: 1,
    generatedAt: '2026-11-16T00:00:00.000Z', documentVersion: 1, snapshot: reserved.snapshot, plan: reserved.plan,
    customerSnapshots: [{ billingGroupId: 'test-v2-group', customerSnapshot: { name: 'Different Legal Company', mark: 'Document Mark', phone: null, city: null } }] };
  expect((await acceptPrepaymentGeneration(payload)).result).toBe('APPLIED');
  const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(updated.customerName).toBe('BIZb');
  expect(updated.amount.toString()).toBe('250');
  const stored = await db.mucontInvoiceGeneration.findUniqueOrThrow({ where: { generationId: 'test-v2-gen' } });
  expect(stored.snapshot).toEqual(payload);
  expect(stored.payloadHash).toBe(repairHash(payload));
  expect((await acceptPrepaymentGeneration(payload)).result).toBe('DUPLICATE');
});
