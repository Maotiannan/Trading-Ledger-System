import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
assert.equal(process.env.DATABASE_URL, 'mysql://root:isolated237-only@127.0.0.1:3323/muledger237_test');
const db = new PrismaClient();
const base = process.env.ISOLATED_237_BASE_URL || 'http://127.0.0.1:3324';
assert.ok(['http://127.0.0.1:3324', 'http://127.0.0.1:3326'].includes(base));
const evidence = JSON.parse(fs.readFileSync('out/implementation-20261113/api-results.json', 'utf8'));
const run = `boundary237-${Date.now()}`;
const token = 'isolated237-invoice-token-12345678901234567890';
let cookie;
async function req(path, body, status = 200, integration = false) {
  const res = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json',
    ...(integration ? { Authorization: `Bearer ${token}` } : { Cookie: cookie || '' }) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json(); assert.equal(res.status, status, JSON.stringify(data));
  if (path === '/api/auth') cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return data;
}
const api = (path, body, status) => req('/api/integrations/mucont/v2/' + path, body, status, true);
const passed = [];
try {
  await req('/api/auth', { action: 'login', email: '237@example.test', password: 'Isolated237-test!' });
  const targets = await req(`/api/prepayment-transfers?action=targets&search=${evidence.run}-B1`);
  assert.ok(!targets.data.targets.some(t => t.binding.id === evidence.b.orderId));
  const credits = (await req('/api/prepayment-transfers')).data.credits;
  const credit = credits.find(c => Number(c.availableAmount) > 0);
  assert.ok(credit);
  const before = await db.prepaymentCredit.findUniqueOrThrow({ where: { id: credit.creditId } });
  const count = await db.prepaymentCredit.count();
  await req('/api/prepayment-transfers', { requestId: run, creditId: credit.creditId, expectedRevision: credit.revision,
    targetCustomerId: evidence.b.customerId, targetBinding: { type: 'LEDGER_ORDER', id: evidence.b.orderId }, amount: '1.00', reason: 'Synthetic canceled target' }, 409);
  assert.equal(await db.prepaymentCredit.count(), count);
  assert.deepEqual(await db.prepaymentCredit.findUniqueOrThrow({ where: { id: credit.creditId } }), before);
  passed.push('canceled transfer target is excluded and forged target rolls back without credit changes');

  const last = await db.prepaymentPlan.findFirstOrThrow({ where: { invoiceBatchId: evidence.a.invoiceBatchId, state: 'APPLIED' }, orderBy: { version: 'desc' } });
  const snapshot = { ...last.snapshot, invoiceTotal: '0.00', customers: [], groupChanges: {
    version: 1, expectedPublicationSequence: 4, removedBillingGroupIds: [evidence.a.billingGroupId], cancelInvoice: true } };
  const preview = await api('prepayments/preview', { schemaVersion: 2, snapshot });
  const reserved = await api('prepayment-plans', { schemaVersion: 2, requestId: `${run}-reserve`, mode: 'RECALCULATE',
    snapshot: preview.snapshot, expectedRevision: preview.revision, previousPlan: preview.previousPlan });
  const receiptCount = await db.receipt.count();
  await req('/api/receipt', { action: 'direct-create', receiptNo: `${run}-blocked`, date: null, tel: null, usd: 10,
    invNo: snapshot.invoiceNo, orderNo: `${evidence.run}-A1/${evidence.run}-A2`, payer: 'Synthetic', customerId: evidence.a.customerId,
    customerMark: 'LATEST MARK', customerName: 'A', customerPhone: '', customerCity: '', isDeposit: false }, 409);
  assert.equal(await db.receipt.count(), receiptCount);
  await api(`prepayment-plans/${reserved.plan.planId}/release`, { schemaVersion: 2, requestId: `${run}-release`,
    expectedVersion: reserved.plan.version, reason: 'Synthetic boundary check complete' });
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: evidence.a.orderId } })).canceledAt, null);
  passed.push('reserved cancellation freezes new receipts and release leaves existing receivable intact');

  const user = await db.user.create({ data: { email: `${run}@example.test`, role: 'USER', level: 3, parentId: 'isolated237-admin',
    password: await bcrypt.hash('Isolated237-test!', 4) } });
  const customer = await db.customer.create({ data: { mark: run, normalizedMark: run, name: run, orderName: run, phone: '', city: '', ownerId: user.id, createdBy: user.id } });
  const invoice = await db.invoice.create({ data: { invNo: run, createdBy: user.id } });
  const target = await db.order.create({ data: { orderNo: `${run}-target`, invoiceId: invoice.id, customerId: customer.id, amount: 100,
    orderBalance: 90, paymentAllocationMode: true, createdBy: user.id } });
  const pool = await db.invoice.findUniqueOrThrow({ where: { invNo: 'DEPOSIT_POOL' } });
  const source = await db.order.create({ data: { orderNo: `${run}-private`, invoiceId: pool.id, customerId: evidence.a.customerId,
    amount: 0, orderBalance: 0, paymentAllocationMode: true, createdBy: 'isolated237-admin' } });
  const original = await db.receipt.create({ data: { orderId: source.id, orderNo: source.orderNo, customerId: evidence.a.customerId,
    usd: 100, status: 'RECEIVED', receiptNo: `${run}-PRIVATE`, payer: 'PRIVATE PAYER', imageUrl: '/private-image.png', createdBy: 'isolated237-admin' } });
  const root = await db.receiptFunding.create({ data: { receiptId: original.id, originalReceiptId: original.id, originalOrderId: source.id,
    originalCustomerId: evidence.a.customerId, receivedAmount: 100, receiptSnapshot: { synthetic: true } } });
  await db.prepaymentCredit.create({ data: { fundingId: root.id, customerId: evidence.a.customerId, amount: 90 } });
  const contribution = await db.prepaymentCredit.create({ data: { fundingId: root.id, customerId: customer.id, amount: 10 } });
  await db.prepaymentAllocation.create({ data: { fundingId: root.id, creditId: contribution.id, orderId: target.id, amount: 10, state: 'APPLIED', appliedAt: new Date() } });
  await req('/api/auth', { action: 'login', email: user.email, password: 'Isolated237-test!' });
  const rows = (await req(`/api/invoice?orderId=${target.id}`)).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].appliedToOrderAmount, 10);
  for (const key of ['originalReceiptAmount', 'payer', 'receiptNo', 'imageUrl']) assert.equal(rows[0][key], null);
  assert.equal(rows[0].sourceRestricted, true);
  passed.push('visible target reveals contribution only, not foreign payer, receipt number, gross amount or image');
  fs.writeFileSync('out/implementation-20261113/api-boundaries.json', JSON.stringify({ status: 'PASS', run, passed }, null, 2));
  console.log(passed.map(x => `PASS ${x}`).join('\n'));
} finally { await db.$disconnect(); }
