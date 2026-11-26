import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

assert.equal(process.env.DATABASE_URL, 'mysql://root:isolated237-only@127.0.0.1:3323/muledger237_test', 'Isolated DB required');
const db = new PrismaClient();
const base = process.env.ISOLATED_237_BASE_URL || 'http://127.0.0.1:3324';
assert.ok(['http://127.0.0.1:3324', 'http://127.0.0.1:3326'].includes(base));
const token = 'isolated237-invoice-token-12345678901234567890';
const marksToken = 'isolated237-customer-token-12345678901234567890';
const run = Date.now().toString(36);
const admin = 'isolated237-admin';
const passed = [];
const reserveRequests = new Map();
let cookie = '';
async function request(path, body, expected = 200, authorization = token, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + path, { method, headers: {
    'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : { Cookie: cookie }),
  }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const raw = await res.text(); let data; try { data = JSON.parse(raw); } catch { throw Error(raw.slice(0, 1200)); }
  assert.equal(res.status, expected, JSON.stringify(data));
  if (path === '/api/auth' && res.status === 200) cookie = res.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  return data;
}
const api = (path, body, expected) => request('/api/integrations/mucont/v2/' + path, body, expected);
const pass = name => { passed.push(name); console.log('PASS', name); };
async function reserve(snapshot, previousPlan = null) {
  const preview = await api('prepayments/preview', { schemaVersion: 2, snapshot });
  const body = { schemaVersion: 2, requestId: `${run}-${Math.random()}`, mode: 'RECALCULATE',
    snapshot: preview.snapshot, expectedRevision: preview.revision, previousPlan };
  const result = await api('prepayment-plans', body);
  reserveRequests.set(result.plan.planId, body);
  return result;
}
function generation(plan, seq) { return { schemaVersion: 2, source: 'MUCONT', generationId: `${run}-gen-${seq}`,
  publicationSequence: seq, generatedAt: new Date().toISOString(), documentVersion: seq,
  snapshot: plan.snapshot, plan: plan.plan, customerSnapshots: plan.groups.map(g => ({ billingGroupId: g.billingGroupId,
    customerSnapshot: { mark: 'OLD SNAPSHOT', name: 'Original name', phone: null, city: null } })) }; }
try {
  await db.user.upsert({ where: { id: admin }, update: {}, create: { id: admin, email: '237@example.test', role: 'ADMIN', level: 1,
    password: await bcrypt.hash('Isolated237-test!', 4) } });
  const pool = await db.invoice.upsert({ where: { invNo: 'DEPOSIT_POOL' }, update: {}, create: { invNo: 'DEPOSIT_POOL', createdBy: admin } });
  const customers = [];
  for (const name of ['A', 'B']) customers.push(await db.customer.create({ data: { id: `${run}-${name}`, mark: `${run}-${name}`,
    normalizedMark: `${run}-${name}`, orderName: `${run}-${name}`, name, phone: '', city: '', ownerId: admin, createdBy: admin } }));
  const sourceOrder = await db.order.create({ data: { orderNo: `${run}-A1`, invoiceId: pool.id, amount: 0, orderBalance: -3000, customerId: customers[0].id, createdBy: admin } });
  const sourceReceipt = await db.receipt.create({ data: { orderId: sourceOrder.id, orderNo: sourceOrder.orderNo, receiptNo: `${run}-R1`,
    customerId: customers[0].id, usd: 3000, status: 'RECEIVED', createdBy: admin, imageUrl: '/synthetic-receipt.png' } });
  const groupA = { billingGroupId: `${run}-group-A`, muledgerCustomerId: customers[0].id,
    orderRefs: [{ binding: { type: 'LEDGER_ORDER', id: sourceOrder.id }, sourceOrderNo: sourceOrder.orderNo, displayOrderNo: sourceOrder.orderNo },
      { binding: null, sourceOrderNo: `${run}-A2`, displayOrderNo: `${run}-A2` }],
    goodsAmount: '4900.00', freightAmount: '100.00', adjustmentAmount: '0.00', totalAmount: '5000.00' };
  const groupB = { billingGroupId: `${run}-group-B`, muledgerCustomerId: customers[1].id,
    orderRefs: [{ binding: null, sourceOrderNo: `${run}-B1`, displayOrderNo: `${run}-B1` }],
    goodsAmount: '1000.00', freightAmount: '0.00', adjustmentAmount: '0.00', totalAmount: '1000.00' };
  const input = { invoiceBatchId: `${run}-batch`, invoiceNo: `${run}-INV`, currency: 'USD', invoiceTotal: '6000.00', customers: [groupA, groupB] };
  const first = await reserve(input);
  const firstAck = await api('invoice-generations', generation(first, 1));
  const groups = await db.mucontInvoiceGroup.findMany({ where: { invoiceBatchId: input.invoiceBatchId } });
  const a = groups.find(g => g.customerId === customers[0].id), b = groups.find(g => g.customerId === customers[1].id);
  await request('/api/auth', { action: 'login', email: '237@example.test', password: 'Isolated237-test!' }, 200, null);
  const history = await request(`/api/invoice?orderId=${a.orderId}`, undefined, 200, null);
  assert.equal(history.data.length, 1); assert.equal(history.data[0].appliedToOrderAmount, 3000); assert.equal(history.data[0].receiptNo, sourceReceipt.receiptNo);
  pass('real API resolves allocated original receipt and per-order amount');
  await db.customer.update({ where: { id: customers[0].id }, data: { mark: 'LATEST MARK' } });
  const marks = await request('/api/integrations/mucont/v1/customers/marks', { customerIds: [customers[0].id, customers[0].id, 'missing'] }, 200, marksToken);
  assert.equal(marks.items.length, 1); assert.equal(marks.items[0].mark, 'LATEST MARK'); assert.deepEqual(marks.missingCustomerIds, ['missing']);
  await request('/api/integrations/mucont/v1/customers/marks', { customerIds: [customers[0].id] }, 401, 'wrong');
  const invoicesBefore = await request('/api/invoice', undefined, 200, null);
  const shownA = invoicesBefore.data.flatMap(i => i.orders).find(o => o.id === a.orderId);
  assert.equal(shownA.customerMark, 'LATEST MARK'); assert.equal(shownA.customerName, 'Original name');
  pass('latest MARK changes without rewriting name snapshot; batch auth/dedup/missing verified');
  const removeA = { ...first.snapshot, invoiceTotal: '1100.00', customers: [{ ...first.snapshot.customers[1], totalAmount: '1100.00', freightAmount: '100.00' }],
    groupChanges: { version: 1, expectedPublicationSequence: 1, removedBillingGroupIds: [groupA.billingGroupId], cancelInvoice: false } };
  await api('prepayments/preview', { schemaVersion: 2, snapshot: { ...removeA, groupChanges: undefined } }, 409);
  await api('prepayments/preview', { schemaVersion: 2, snapshot: { ...removeA, groupChanges: { ...removeA.groupChanges, expectedPublicationSequence: 0 } } }, 409);
  await api('prepayments/preview', { schemaVersion: 2, snapshot: { ...removeA, groupChanges: { ...removeA.groupChanges, removedBillingGroupIds: ['unknown'] } } }, 409);
  const second = await reserve(removeA, first.plan); const secondPayload = generation(second, 2);
  await api('invoice-generations', secondPayload);
  const canceledA = await db.order.findUniqueOrThrow({ where: { id: a.orderId } });
  assert.ok(canceledA.canceledAt); assert.equal(canceledA.amount.toFixed(2), '0.00'); assert.equal(canceledA.orderBalance.toFixed(2), '0.00');
  assert.equal(await db.prepaymentAllocation.count({ where: { orderId: a.orderId, state: 'APPLIED' } }), 0);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: b.orderId } })).amount.toFixed(2), '1100.00');
  assert.equal((await db.receipt.findUniqueOrThrow({ where: { id: sourceReceipt.id } })).orderId, sourceOrder.id);
  assert.equal((await api('invoice-generations', secondPayload)).result, 'DUPLICATE');
  assert.equal((await api('prepayment-plans', reserveRequests.get(second.plan.planId))).plan.planId, second.plan.planId);
  await api('invoice-generations', { ...secondPayload, generatedAt: '2026-11-01T00:00:00Z' }, 409);
  await api('invoice-generations', { ...secondPayload, generationId: `${run}-stale` }, 409);
  pass('partial removal preserves freight/receipt, releases funding, rejects stale and deduplicates replay');
  const unallocatedReceipt = await db.receipt.create({ data: { orderId: b.orderId, customerId: customers[1].id, orderNo: `${run}-B1`,
    usd: 200, receiptNo: `${run}-DIRECT`, status: 'RECEIVED', createdBy: admin, imageUrl: '/synthetic-direct.png' } });
  const cancelAll = { ...second.snapshot, invoiceTotal: '0.00', customers: [],
    groupChanges: { version: 1, expectedPublicationSequence: 2, removedBillingGroupIds: [groupB.billingGroupId], cancelInvoice: true } };
  const third = await reserve(cancelAll, second.plan); const thirdPayload = generation(third, 3);
  await api('invoice-generations', thirdPayload);
  assert.ok((await db.invoice.findUniqueOrThrow({ where: { id: firstAck.ledgerInvoiceId } })).canceledAt);
  const directFunding = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: unallocatedReceipt.id }, include: { credits: true } });
  assert.equal(directFunding.credits[0].amount.toFixed(2), '200.00');
  assert.equal((await db.receipt.findUniqueOrThrow({ where: { id: unallocatedReceipt.id } })).orderId, b.orderId);
  const before = await db.prepaymentCredit.count(); await api('invoice-generations', thirdPayload); assert.equal(await db.prepaymentCredit.count(), before);
  const list = await request('/api/invoice', undefined, 200, null);
  assert.ok(!list.data.some(i => i.id === firstAck.ledgerInvoiceId));
  const deposit = list.data.find(i => i.invNo === 'DEPOSIT_POOL').depositPool;
  assert.ok(deposit.rows.some(r => r.creditId === directFunding.credits[0].id && r.availableAmount === '200.00'));
  assert.equal(deposit.rows.filter(row => row.receiptNo?.startsWith(run))
    .reduce((sum, row) => sum + Number(row.availableAmount), 0), 3200);
  pass('full cancel keeps direct receipt identity and returns funds to visible pool with idempotent ACK');
  const restore = { ...first.snapshot, customers: [first.snapshot.customers[0]], invoiceTotal: '5000.00' };
  const fourth = await reserve(restore, third.plan); await api('invoice-generations', generation(fourth, 4));
  assert.equal((await db.mucontInvoiceGroup.findUniqueOrThrow({ where: { invoiceBatchId_billingGroupId: { invoiceBatchId: input.invoiceBatchId, billingGroupId: groupA.billingGroupId } } })).orderId, a.orderId);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).canceledAt, null);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).orderBalance.toFixed(2), '2000.00');
  pass('restoration reuses original group/order identity and original funding');

  const afterRestore = await request('/api/invoice', undefined, 200, null);
  const restoredInvoice = afterRestore.data.find(i => i.id === firstAck.ledgerInvoiceId);
  assert.equal(restoredInvoice.source.canResync, true);
  assert.equal(restoredInvoice.orders.length, 1);
  assert.ok(restoredInvoice.source.revision);
  const canceledHistory = await request(`/api/invoice?orderId=${b.orderId}`, undefined, 200, null);
  assert.equal(canceledHistory.data[0].receiptNo, unallocatedReceipt.receiptNo);
  pass('retained group history stays accessible without disabling whole-invoice actions');

  const newBatch = { invoiceBatchId: `${run}-new-batch`, invoiceNo: `${run}-NEW-INV`, currency: 'USD', invoiceTotal: '1000.00',
    customers: [{ ...groupB, billingGroupId: `${run}-new-group` }] };
  const next = await reserve(newBatch);
  const nextPayload = { ...generation(next, 1), generationId: `${run}-new-generation` };
  const nextAck = await api('invoice-generations', nextPayload);
  const newOrder = await db.order.findFirstOrThrow({ where: { invoiceId: nextAck.ledgerInvoiceId } });
  assert.notEqual(newOrder.id, b.orderId);
  assert.equal(newOrder.orderNo, `${run}-B1`);
  assert.equal(newOrder.orderBalance.toFixed(2), '800.00');
  assert.equal((await db.prepaymentAllocation.aggregate({ where: { fundingId: directFunding.id, state: 'APPLIED' },
    _sum: { amount: true } }))._sum.amount.toFixed(2), '200.00');
  assert.equal((await db.receipt.findUniqueOrThrow({ where: { id: unallocatedReceipt.id } })).orderId, b.orderId);
  pass('same ORDER can ship in a new batch, reusing released credit once without moving the old receipt');

  const legacyOrder = await db.order.create({ data: { invoiceId: pool.id, orderNo: `${run}-LEGACY`, customerId: customers[0].id,
    amount: 0, orderBalance: -10, createdBy: admin } });
  await db.receipt.create({ data: { orderId: legacyOrder.id, customerId: customers[0].id, usd: 10, status: 'RECEIVED', createdBy: admin } });
  const transferCount = await db.balanceTransfer.count();
  await request('/api/invoice', { action: 'transferBalance', fromOrderId: legacyOrder.id, toOrderNo: newOrder.orderNo,
    transferAmount: 5, requestId: `${run}-legacy-transfer` }, 409, null, 'PUT');
  assert.equal(await db.balanceTransfer.count(), transferCount);
  assert.equal(await db.receipt.count({ where: { orderId: newOrder.id } }), 0);
  pass('legacy synthetic transfer into a linked group is rejected and transaction rolls back');

  for (const role of ['SALES', 'USER']) {
    const user = await db.user.create({ data: { id: `${run}-${role}`, email: `${run}-${role}@example.test`, role, level: role === 'USER' ? 3 : 4,
      password: await bcrypt.hash('Isolated237-test!', 4) } });
    await request('/api/auth', { action: 'login', email: user.email, password: 'Isolated237-test!' }, 200, null);
    const invisible = await request(`/api/invoice?orderId=${a.orderId}`, undefined, 200, null);
    assert.deepEqual(invisible.data, []);
    await request('/api/prepayment-transfers', {}, 403, null);
  }
  pass('unrelated USER/SALES cannot view payment history or transfer credit');
  fs.writeFileSync('out/implementation-20261113/api-results.json', JSON.stringify({ status: 'PASS', run, passed, invoiceId: firstAck.ledgerInvoiceId, sourceOrderId: sourceOrder.id, a, b }, null, 2));
} finally { await db.$disconnect(); }
