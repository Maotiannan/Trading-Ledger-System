import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

assert.equal(process.env.DATABASE_URL, 'mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_invoice_r2_test');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3312';
const run = 'identity-' + Date.now().toString(36);
const evidence = [];
let cookie = '';
async function api(path, body, expected = 200, method = 'POST') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return { result, response };
}
async function deliver(snapshot) {
  const response = await fetch(base + '/api/integrations/mucont/v1/invoice-generations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invoice-r2-receive-isolated-12345678901234567890' }, body: JSON.stringify(snapshot) });
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
}
function pass(name) { evidence.push(name); console.log('PASS', name); }
try {
  const auth = await api('/api/auth', { action: 'login', email: 'invoice-r2-admin@example.test', password: 'InvoiceR2-Test!2026' });
  cookie = auth.response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const snapshot = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/invoice-generation-v1/fixtures.json', import.meta.url)))[0].request;
  snapshot.generationId += '-' + run; snapshot.invoiceBatchId += '-' + run; snapshot.invoiceNo += '-' + run;
  for (const [index, group] of snapshot.customers.entries()) {
    group.muledgerCustomerId = `${run}-customer-${index}`;
    group.orderRefs.forEach((ref) => { ref.sourceOrderNo += '-' + run; ref.displayOrderNo += '-' + run; });
    group.customerSnapshot.mark = 'LEGACY-' + index + '-' + run;
    await db.customer.create({ data: { id: group.muledgerCustomerId, mark: 'CURRENT-' + index + '-' + run,
      normalizedMark: ('CURRENT-' + index + '-' + run).toLowerCase(), orderName: 'CURRENT-' + index + '-' + run,
      name: 'Current master ' + index, phone: '', city: '', ownerId: 'invoice-r2-admin', createdBy: 'invoice-r2-admin' } });
  }
  const applied = await deliver(snapshot);
  const groupA = snapshot.customers[0], groupB = snapshot.customers[1];
  const orderA = await db.order.findFirstOrThrow({ where: { invoiceId: applied.ledgerInvoiceId, customerId: groupA.muledgerCustomerId } });
  const createReceipt = (suffix, usd, fields = {}, expected = 200) => api('/api/receipt', { action: 'direct-create',
    receiptNo: `${run}-${suffix}`, usd, orderNo: groupA.orderRefs[0].displayOrderNo, customerMark: groupA.customerSnapshot.mark, ...fields }, expected);
  await createReceipt('old', 4000);
  const original = await db.receipt.findFirstOrThrow({ where: { receiptNo: `${run}-old` } });
  assert.equal(original.customerId, groupA.muledgerCustomerId);
  assert.equal(original.needsCustomerFix, false);
  let order = await db.order.findUniqueOrThrow({ where: { id: orderA.id } });
  assert.equal(order.customerId, groupA.muledgerCustomerId); assert.equal(Number(order.orderBalance), 6300);
  pass('old/unmatched source MARK uses stable customer and preserves order identity');
  await createReceipt('wrong-text', 100, { customerMark: 'CURRENT-1-' + run });
  assert.equal((await db.receipt.findFirstOrThrow({ where: { receiptNo: `${run}-wrong-text` } })).customerId, groupA.muledgerCustomerId);
  pass('text resolving to another customer cannot replace stable source identity');
  const count = await db.receipt.count();
  const before = await db.order.findUniqueOrThrow({ where: { id: orderA.id } });
  await createReceipt('conflict', 1, { customerId: groupB.muledgerCustomerId }, 409);
  assert.equal(await db.receipt.count(), count);
  assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: orderA.id } }), before);
  pass('explicit conflicting customer rejected atomically before receipt write');
  await api('/api/customer/fixes', { action: 'link-order-customer', orderId: orderA.id, customerId: groupB.muledgerCustomerId }, 409);
  await api('/api/customer/fixes', { action: 'link-receipt-customer', receiptId: original.id, customerId: groupB.muledgerCustomerId }, 409);
  assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: orderA.id } }), before);
  assert.deepEqual(await db.receipt.findUniqueOrThrow({ where: { id: original.id } }), original);
  pass('order/receipt customer repair cannot overwrite stable source group');
  await api('/api/receipt', { action: 'update', receiptId: original.id, data: { receiptNo: original.receiptNo, date: '2026-11-11',
    orderNo: groupA.orderRefs[0].displayOrderNo, invNo: snapshot.invoiceNo, customerMark: 'WRONG EDIT TEXT', payer: 'PAYER', tel: null } });
  const edited = await db.receipt.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(edited.customerId, groupA.muledgerCustomerId); assert.equal(edited.customerMark, groupA.customerSnapshot.mark);
  pass('receipt edit retains locked stable customer snapshot');
  await api('/api/detail', { action: 'direct-create', date: '2026-11-11', items: [
    { orderNo: groupA.orderRefs[0].displayOrderNo, mark: 'CURRENT-1-' + run, amount: 333 },
  ] });
  const derived = await db.receipt.findFirstOrThrow({ where: { orderId: orderA.id, usd: 333 } });
  assert.equal(derived.customerId, groupA.muledgerCustomerId);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderA.id } })).customerId, groupA.muledgerCustomerId);
  pass('Detail-generated receipt uses stable group instead of item MARK');
  const next = structuredClone(snapshot); next.generationId += '-next'; next.publicationSequence = 2; next.documentVersion = 2;
  next.customers[0].goodsAmount = '19700.00'; next.customers[0].totalAmount = '20000.00'; next.invoiceTotal = '21000.00';
  await Promise.all([deliver(next), createReceipt('concurrent', 567)]);
  order = await db.order.findUniqueOrThrow({ where: { id: orderA.id } });
  assert.equal(order.customerId, groupA.muledgerCustomerId); assert.equal(Number(order.amount), 20000);
  assert.equal(Number(order.orderBalance), 15000);
  assert.equal(await db.receipt.count({ where: { orderId: orderA.id, NOT: { customerId: groupA.muledgerCustomerId } } }), 0);
  pass('concurrent source regeneration and receipt preserve identity and exact 15000 balance');
  fs.writeFileSync(new URL('../../../out/invoice-r2-isolated/source-customer-acceptance.json', import.meta.url),
    JSON.stringify({ run, invoiceId: applied.ledgerInvoiceId, orderId: orderA.id, completedAt: new Date().toISOString(), evidence }, null, 2));
} finally { await db.$disconnect(); }
