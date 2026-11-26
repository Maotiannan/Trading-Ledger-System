import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const expected = 'mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_prepayment_20261111';
assert.equal(process.env.DATABASE_URL, expected, 'Refusing a non-isolated database');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3317';
const token = 'prepayment-isolated-only-token-20261111';
const run = 'p' + Date.now();
const evidence = [];
const pass = (name, detail = {}) => { evidence.push({ name, ...detail }); console.log('PASS', name); };
async function api(path, body, status = 200) {
  const r = await fetch(base + '/api/integrations/mucont/v2/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000) });
  const raw = await r.text(); let data; try { data = JSON.parse(raw); } catch { throw new Error(raw.slice(0,1000)); }
  assert.equal(r.status, status, JSON.stringify(data)); return data;
}
async function customer(label) { return db.customer.create({ data: { id: `${run}-customer-${label}`, mark: `${run}-${label}`,
  normalizedMark: `${run}-${label}`, orderName: label.toUpperCase(), name: label, phone: '', city: '', ownerId: 'prepay-admin', createdBy: 'prepay-admin' } }); }
async function pool(c, label, usd) {
  const no = `${run}-${label}`;
  const order = await db.order.create({ data: { invoiceId: `${run}-pool`, orderNo: no, customerId: c.id, amount: 0, orderBalance: -usd, createdBy: 'prepay-admin' } });
  await db.orderAlias.create({ data: { orderId: order.id, aliasNo: no.toLowerCase() } });
  const receipt = await db.receipt.create({ data: { orderId: order.id, orderNo: no, customerId: c.id, usd, status: 'RECEIVED',
    createdBy: 'prepay-admin', isDeposit: true, receiptNo: `${run}-receipt-${label}`, imageUrl: '/upload/synthetic.png' } });
  return { order, receipt };
}
function snapshot(label, c, originals, total, freight = '0.00') {
  return { invoiceBatchId: `${run}-batch-${label}`, invoiceNo: `${run}-INV-${label}`, currency: 'USD', invoiceTotal: total,
    customers: [{ billingGroupId: `${run}-group-${label}`, muledgerCustomerId: c.id,
      orderRefs: originals.map(row => ({ binding: { type: 'LEDGER_ORDER', id: row.order.id }, sourceOrderNo: row.order.orderNo, displayOrderNo: row.order.orderNo })),
      goodsAmount: (Number(total) - Number(freight)).toFixed(2), adjustmentAmount: '0.00', freightAmount: freight, totalAmount: total }] };
}
async function reserve(input, requestId, previousPlan = null) {
  const preview = await api('prepayments/preview', { schemaVersion: 2, snapshot: input });
  const body = { schemaVersion: 2, requestId, mode: 'RECALCULATE', snapshot: preview.snapshot, expectedRevision: preview.revision, previousPlan };
  return { plan: await api('prepayment-plans', body), body, preview };
}
function delivery(plan, label, sequence = 1, snapshotOverride = plan.snapshot) {
  return { schemaVersion: 2, source: 'MUCONT', generationId: `${run}-gen-${label}`, publicationSequence: sequence,
    generatedAt: '2026-11-11T10:00:00.000Z', documentVersion: sequence, snapshot: snapshotOverride, plan: plan.plan,
    customerSnapshots: plan.groups.map(group => ({ billingGroupId: group.billingGroupId,
      customerSnapshot: { mark: 'TEST', name: 'Synthetic client', phone: null, city: null } })) };
}
async function rawReceiptUnchanged(receipt) {
  assert.deepEqual(JSON.parse(JSON.stringify(await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } }))), JSON.parse(JSON.stringify(receipt)));
}
try {
  await db.user.upsert({ where: { id: 'prepay-admin' }, create: { id: 'prepay-admin', email: 'prepay-admin@example.test',
    password: await bcrypt.hash('Prepay-isolated-test-123!', 4), role: 'ADMIN', level: 1 }, update: {} });
  await db.invoice.create({ data: { id: `${run}-pool`, invNo: 'DEPOSIT_POOL', createdBy: 'prepay-admin' } });
  for (const [label, amount, used, remainder] of [['five-thousand', '5000.00', '3000.00', '0.00'], ['five-hundred', '500.00', '500.00', '2500.00']]) {
    const c = await customer(label); const source = await pool(c, label, 3000);
    const beforeFunding = await db.receiptFunding.count();
    const input = snapshot(label, c, [source], amount);
    await api('prepayments/preview', { schemaVersion: 2, snapshot: input });
    assert.equal(await db.receiptFunding.count(), beforeFunding);
    const r = await reserve(input, `${run}-reserve-${label}`);
    assert.equal(r.plan.groups[0].prepaymentAmount, used); assert.equal(r.plan.groups[0].unusedAmount, remainder);
    assert.deepEqual(await api('prepayment-plans', r.body), r.plan);
    assert.equal((await api(`prepayment-plans?requestId=${encodeURIComponent(r.body.requestId)}`)).plan.hash, r.plan.plan.hash);
    const payload = delivery(r.plan, label);
    const applied = await api('invoice-generations', payload); assert.equal(applied.result, 'APPLIED');
    assert.equal((await api('invoice-generations', payload)).result, 'DUPLICATE');
    const target = await db.order.findUniqueOrThrow({ where: { id: source.order.id } });
    assert.equal(target.amount.toFixed(2), amount); assert.equal(target.orderBalance.toFixed(2), (Number(amount) - Number(used)).toFixed(2));
    await rawReceiptUnchanged(source.receipt);
    const renamed = structuredClone(r.plan.snapshot); renamed.invoiceNo += '-NEW'; renamed.customers[0].orderRefs[0].displayOrderNo += 'B';
    const reused = await api('prepayment-plans', { schemaVersion: 2, requestId: `${run}-reuse-${label}`, mode: 'REUSE', snapshot: renamed, expectedRevision: null, previousPlan: r.plan.plan });
    assert.deepEqual(reused.plan, r.plan.plan);
    await api('invoice-generations', delivery(reused, label + '-new', 2, renamed));
    assert.equal((await db.prepaymentAllocation.aggregate({ where: { invoiceBatchId: input.invoiceBatchId, state: 'APPLIED' }, _sum: { amount: true } }))._sum.amount.toFixed(2), used);
    pass('amount ' + amount + ', idempotent reserve/delivery, lost response lookup and display-only REUSE', { amount, used, remainder });
  }
  const c = await customer('combined');
  const first = await pool(c, 'combined-a', 1000); const second = await pool(c, 'combined-b', 2000);
  const composite = snapshot('combined', c, [first, second], '2100.00', '100.00');
  const p = await reserve(composite, `${run}-reserve-combined`);
  assert.equal(p.plan.groups[0].prepaymentAmount, '2100.00'); assert.equal(p.plan.groups[0].unusedAmount, '900.00');
  const applied = await api('invoice-generations', delivery(p.plan, 'combined'));
  const target = await db.order.findFirstOrThrow({ where: { invoiceId: applied.ledgerInvoiceId } });
  assert.equal(target.orderBalance.toFixed(2), '0.00'); assert.equal(target.amount.toFixed(2), '2100.00');
  for (const source of [first, second]) { await rawReceiptUnchanged(source.receipt); const original = await db.order.findUniqueOrThrow({ where: { id: source.order.id } });
    assert.equal(original.invoiceId, `${run}-pool`); assert.equal(original.orderNo, source.order.orderNo); assert.equal(original.amount.toFixed(2), '0.00'); }
  pass('two pool sources combined, one freight, original orders and receipts preserved');

  const emptyCustomer = await customer('no-pi');
  const empty = { invoiceBatchId: `${run}-no-pi`, invoiceNo: `${run}-NO-PI`, currency: 'USD', invoiceTotal: '500.00', customers: [{
    billingGroupId: `${run}-no-pi-group`, muledgerCustomerId: emptyCustomer.id,
    orderRefs: [{ binding: null, sourceOrderNo: `${run}-MANUAL`, displayOrderNo: `${run}-MANUAL-B` }],
    goodsAmount: '500.00', adjustmentAmount: '0.00', freightAmount: '0.00', totalAmount: '500.00',
  }] };
  const emptyPlan = await reserve(empty, `${run}-no-pi-request`);
  assert.equal(emptyPlan.plan.groups[0].prepaymentAmount, '0.00');
  assert.equal(emptyPlan.plan.snapshot.customers[0].orderRefs[0].binding.type, 'LEDGER_SOURCE');
  await api('invoice-generations', delivery(emptyPlan.plan, 'no-pi'));
  pass('no PI/no ledger original supports durable zero plan');

  const ca = await customer('cancel'); const sa = await pool(ca, 'cancel', 3000);
  const cancel = await reserve(snapshot('cancel', ca, [sa], '500.00'), `${run}-cancel-request`);
  await api(`prepayment-plans/${cancel.plan.plan.planId}/release`, { schemaVersion: 2, requestId: `${run}-cancel`, expectedVersion: cancel.plan.plan.version, reason: 'Isolated cancellation' });
  await api('invoice-generations', delivery(cancel.plan, 'cancel'), 409);
  assert.equal(await db.invoice.count({ where: { invNo: cancel.plan.snapshot.invoiceNo } }), 0);
  pass('released reservation cannot be applied by a late generation');
  const rawA = await pool(ca, 'wrong-binding-a', 500);
  const wrong = snapshot('wrong-binding', ca, [rawA], '500.00');
  wrong.customers[0].orderRefs[0].sourceOrderNo = sa.order.orderNo;
  await api('prepayments/preview', { schemaVersion: 2, snapshot: wrong }, 409);
  pass('explicit source binding cannot fall back to a different same-customer ORDER');

  fs.mkdirSync('out/prepayment', { recursive: true });
  fs.writeFileSync('out/prepayment/api-evidence.json', JSON.stringify({ status: 'PASS', database: 'muledger_prepayment_20261111',
    productionAccess: false, run, completedAt: new Date().toISOString(), evidence }, null, 2));
} finally { await db.$disconnect(); }
