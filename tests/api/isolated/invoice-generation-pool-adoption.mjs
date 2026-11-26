import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const expectedUrl = 'mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_invoice_pool_20261111';
assert.equal(process.env.DATABASE_URL, expectedUrl, 'Refusing a non-isolated pool test database');
const container = JSON.parse(execFileSync('docker', ['inspect', 'muledger-invoice-pool-check-20261111'], { encoding: 'utf8' }))[0];
assert.equal(container.Image, 'sha256:45aadd8b3e52345d671bd1e036e501b1cdbfaeb083ad5d73dc6327d755b8164a');
assert.deepEqual(Object.keys(container.NetworkSettings.Networks), ['muledger-invoice-r2-isolated_default']);
assert.equal(container.NetworkSettings.Ports['3000/tcp'][0].HostIp, '127.0.0.1');
assert.equal(container.NetworkSettings.Ports['3000/tcp'][0].HostPort, '3316');
assert.ok(container.Mounts.every((mount) => mount.Type === 'tmpfs'), 'Unexpected persistent app mount');
const env = Object.fromEntries(container.Config.Env.map((row) => {
  const index = row.indexOf('='); return [row.slice(0, index), row.slice(index + 1)];
}));
assert.equal(env.DATABASE_URL, expectedUrl.replace('127.0.0.1:3313', 'mysql:3306'));
assert.equal(env.MUCONT_INVOICE_ACTOR_ID, 'pool-check-admin');

const db = new PrismaClient();
const base = 'http://127.0.0.1:3316';
const actorId = 'pool-check-admin';
const evidence = [];
const tables = ['invoice', 'order', 'orderAlias', 'receipt', 'receiptHistory', 'mucontInvoiceSource', 'mucontInvoiceGroup', 'mucontInvoiceGeneration', 'mucontInvoiceResync', 'auditLog'];
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const record = (name, detail = {}) => { evidence.push({ name, ...detail }); console.log('PASS', name, JSON.stringify(detail)); };
async function state() {
  const snapshot = {};
  for (const table of tables) {
    const rows = (await db[table].findMany()).map(canonical).sort();
    snapshot[table] = { count: rows.length, hash: hash(rows) };
  }
  return snapshot;
}
async function deliver(payload, status = 200) {
  const response = await fetch(base + '/api/integrations/mucont/v1/invoice-generations', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.MUCONT_INVOICE_RECEIVE_TOKEN },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
function group(label, customerId, orderNos, goods, freight = '0.00') {
  const total = (Math.round(Number(goods) * 100) + Math.round(Number(freight) * 100)) / 100;
  return { billingGroupId: 'pool-group-' + label, muledgerCustomerId: customerId,
    customerSnapshot: { mark: 'POOL-' + label, name: 'Isolated Pool ' + label, phone: null, city: null },
    orderRefs: orderNos.map((orderNo) => ({ sourceOrderNo: orderNo, displayOrderNo: orderNo })),
    goodsAmount: goods, adjustmentAmount: '0.00', freightAmount: freight, totalAmount: total.toFixed(2) };
}
function payload(label, customers) {
  return { schemaVersion: 1, source: 'MUCONT', generationId: 'pool-generation-' + label,
    invoiceBatchId: 'pool-batch-' + label, publicationSequence: 1, invoiceNo: 'POOL-INV-' + label,
    generatedAt: '2026-11-11T09:00:00.000Z', documentVersion: 1, currency: 'USD',
    invoiceTotal: (customers.reduce((sum, row) => sum + Math.round(Number(row.totalAmount) * 100), 0) / 100).toFixed(2), customers };
}
async function customer(label) {
  return db.customer.create({ data: { id: 'pool-customer-' + label, mark: 'POOL-' + label,
    normalizedMark: 'pool-' + label.toLowerCase(), orderName: 'POOL-' + label, name: 'Isolated Pool ' + label,
    phone: '', city: '', ownerId: actorId, createdBy: actorId } });
}
async function fixture(label, customerId) {
  const orderNo = 'POOL-' + label;
  const order = await db.order.create({ data: { invoiceId: 'pool-invoice', orderNo, amount: 0, orderBalance: -3000,
    customerId, createdBy: actorId, createdAt: new Date('2026-07-01T00:00:00Z') } });
  await db.orderAlias.create({ data: { aliasNo: orderNo.toLowerCase(), orderId: order.id } });
  const receipt = await db.receipt.create({ data: { receiptNo: 'POOL-RECEIPT-' + label, usd: 3000, orderNo,
    orderId: order.id, customerId, createdBy: actorId, status: 'RECEIVED', isDeposit: true, invNo: null,
    date: new Date('2026-07-01T00:00:00Z'), createdAt: new Date('2026-07-01T00:01:00Z'),
    imageUrl: '/upload/images/receipts/pool-fixture.png', imageName: 'pool-fixture.png', note: 'Synthetic isolated fixture; preserve every field' } });
  await db.receiptHistory.create({ data: { receiptId: receipt.id, receiptNo: receipt.receiptNo, usd: receipt.usd,
    status: 'SR_Received', orderNo, createdBy: actorId, note: 'Synthetic existing history', imageUrl: receipt.imageUrl } });
  return { order, receipt, histories: await db.receiptHistory.findMany({ where: { receiptId: receipt.id } }) };
}

try {
  assert.equal(await db.user.count(), 0, 'Test database is not fresh');
  await db.user.create({ data: { id: actorId, email: 'pool-check-admin@example.test', password: 'NO-LOGIN-SYNTHETIC-FIXTURE', role: 'ADMIN', level: 1 } });
  await db.invoice.create({ data: { id: 'pool-invoice', invNo: 'DEPOSIT_POOL', createdBy: actorId } });
  for (const example of [
    { label: 'BAPPA-LIKE', goods: '73144.74', freight: '12000.00', amount: '85144.74', balance: '82144.74' },
    { label: 'DEMOPAY-LIKE', goods: '37078.20', freight: '5238.71', amount: '42316.91', balance: '39316.91' },
  ]) {
    const c = await customer(example.label);
    const f = await fixture(example.label, c.id);
    const input = payload(example.label, [group(example.label, c.id, [f.order.orderNo], example.goods, example.freight)]);
    const counts = await state();
    const response = await deliver(input);
    assert.equal(response.result, 'APPLIED');
    const after = await db.order.findUniqueOrThrow({ where: { id: f.order.id } });
    assert.equal(after.invoiceId, response.ledgerInvoiceId);
    assert.equal(after.createdBy, f.order.createdBy);
    assert.equal(after.createdAt.toISOString(), f.order.createdAt.toISOString());
    assert.equal(after.amount.toFixed(2), example.amount);
    assert.equal(after.orderBalance.toFixed(2), example.balance);
    assert.equal(canonical(await db.receipt.findUnique({ where: { id: f.receipt.id } })), canonical(f.receipt));
    assert.equal(canonical(await db.receiptHistory.findMany({ where: { receiptId: f.receipt.id } })), canonical(f.histories));
    assert.equal((await db.mucontInvoiceGroup.findUniqueOrThrow({ where: { orderId: f.order.id } })).customerId, c.id);
    assert.equal(await db.order.count(), counts.order.count, 'Adoption must not create another financial order');
    assert.equal(await db.receipt.count(), counts.receipt.count);
    assert.equal(await db.auditLog.count({ where: { action: 'MUCONT_INVOICE_APPLY', targetId: after.invoiceId } }), 1);
    const applied = await state();
    assert.equal((await deliver(input)).result, 'DUPLICATE');
    assert.deepEqual(await state(), applied, 'Duplicate delivery mutated accounting, receipts or audit');
    record('exact pool adoption and duplicate: ' + example.label, { originalOrderId: f.order.id, originalReceiptId: f.receipt.id,
      amount: example.amount, balance: example.balance, receiptHash: hash(f.receipt), allReceiptAndHistoryFieldsUnchanged: true, duplicateZeroMutations: true });
  }
  const actual = await customer('ACTUAL');
  const different = await customer('DIFFERENT');
  const wrong = await fixture('WRONG-CUSTOMER', actual.id);
  const wrongInput = payload('WRONG-CUSTOMER', [
    group('FIRST-NEW', actual.id, ['POOL-FIRST-NEW'], '100.00'),
    group('MISMATCH', different.id, [wrong.order.orderNo], '5000.00'),
  ]);
  const wrongBefore = await state();
  await deliver(wrongInput, 409);
  assert.deepEqual(await state(), wrongBefore, 'Customer conflict left a partial source/invoice/order/audit write');
  record('mismatched customer rejected atomically', { noPartialInvoiceSourceGroupOrGeneration: true });
  const partial = await fixture('PARTIAL', actual.id);
  const partialInput = payload('PARTIAL', [
    group('NEW-BEFORE-PARTIAL', different.id, ['POOL-SECOND-NEW'], '100.00'),
    group('PARTIAL', actual.id, ['POOL-PARTIAL-EXTRA', partial.order.orderNo], '5000.00'),
  ]);
  const partialBefore = await state();
  await deliver(partialInput, 409);
  assert.deepEqual(await state(), partialBefore, 'Partial composite conflict left accounting changes');
  record('partial composite pool adoption rejected atomically', { noPartialInvoiceSourceGroupOrGeneration: true });
  const result = { completedAt: new Date().toISOString(), image: container.Image, database: 'muledger_invoice_pool_20261111',
    service: base, productionAccess: false, evidence, finalState: await state() };
  fs.writeFileSync(new URL('../../../out/invoice-r2-isolated/pool-adoption-acceptance.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log('ALL TARGETED POOL ADOPTION CHECKS PASSED');
} finally { await db.$disconnect(); }
