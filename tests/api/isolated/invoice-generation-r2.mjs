import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl !== 'mysql://root:invoice-r2-isolated-only@127.0.0.1:3313/muledger_invoice_r2_test') throw new Error('Refusing non-isolated database');
const db = new PrismaClient();
const base = 'http://127.0.0.1:3312';
const token = 'invoice-r2-receive-isolated-12345678901234567890';
const readToken = 'invoice-r2-read-isolated-12345678901234567890';
const run = Date.now().toString(36);
const evidence = [];
let cookie = '';
const record = (name, detail = {}) => { evidence.push({ name, ...detail }); console.log('PASS', name, JSON.stringify(detail)); };
async function request(path, method = 'GET', body, status = 200, auth = cookie) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return { result, response };
}
async function deliver(snapshot, expected = 200, credential = token) {
  const response = await fetch(base + '/api/integrations/mucont/v1/invoice-generations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential }, body: JSON.stringify(snapshot) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function control(body) { return fetch('http://127.0.0.1:3314/__control', { method: 'POST', headers: { Authorization: 'Bearer ' + readToken }, body: JSON.stringify(body) }); }
async function login(email) {
  const { response } = await request('/api/auth', 'POST', { action: 'login', email, password: 'InvoiceR2-Test!2026' });
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}
const original = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/invoice-generation-v1/fixtures.json', import.meta.url)));
const snapshots = original.map((fixture) => {
  const s = structuredClone(fixture.request);
  s.generationId += '-' + run; s.invoiceBatchId += '-' + run; s.invoiceNo += '-' + run;
  s.customers.forEach((group, index) => {
    group.muledgerCustomerId = 'r2-customer-' + index + '-' + run;
    group.orderRefs.forEach((ref) => { ref.sourceOrderNo += '-' + run; ref.displayOrderNo += '-' + run; });
  });
  return s;
});
const [first, second, third] = snapshots;
try {
  const password = await bcrypt.hash('InvoiceR2-Test!2026', 10);
  for (const [id, level, parentId] of [['invoice-r2-admin', 1, null], ['invoice-r2-partial', 2, 'invoice-r2-admin'], ['invoice-r2-outsider', 1, null]]) {
    await db.user.upsert({ where: { id }, create: { id, email: id + '@example.test', password, role: 'ADMIN', level, parentId }, update: { password } });
  }
  for (const [index, group] of first.customers.entries()) {
    await db.customer.create({ data: { id: group.muledgerCustomerId, mark: group.customerSnapshot.mark + '-' + run, orderName: 'R2-' + index + '-' + run,
      name: group.customerSnapshot.name, phone: '', city: '', normalizedMark: (group.customerSnapshot.mark + '-' + run).toLowerCase(),
      ownerId: index === 0 ? 'invoice-r2-partial' : 'invoice-r2-admin', createdBy: 'invoice-r2-admin' } });
  }
  cookie = await login('invoice-r2-admin@example.test');
  const noAuth = await deliver(first, 401, 'invalid');
  assert.equal(noAuth.error.retryable, false);
  await deliver({ ...first, invoiceTotal: '1.00' }, 422);
  record('dedicated credential and amount validation');
  await control({ latest: first, version: 1, unavailable: false });
  const accepted = await deliver(first);
  assert.equal(accepted.result, 'APPLIED');
  const invoiceId = accepted.ledgerInvoiceId;
  const load = async () => {
    const { result } = await request('/api/invoice?search=' + encodeURIComponent(run));
    return result.data.find((row) => row.id === invoiceId);
  };
  const orders = await db.order.findMany({ where: { invoiceId }, orderBy: { orderNo: 'asc' } });
  const a = orders.find((row) => row.customerId === first.customers[0].muledgerCustomerId);
  assert.equal(orders.length, 2); assert.equal(Number(a.amount), 10300);
  assert.equal(await db.orderAlias.count({ where: { orderId: a.id } }), 2);
  const context = await request('/api/invoice?action=order-context&orderNo=' + encodeURIComponent(first.customers[0].orderRefs[0].displayOrderNo));
  assert.equal(context.result.data.exactMatches[0].id, a.id);
  record('fixture absolute amounts, one group/two ORDERs, individual ORDER lookup', { invoiceId, orderId: a.id });
  const payment = await request('/api/receipt', 'POST', { action: 'direct-create', receiptNo: 'R2-' + run, usd: 4000,
    orderNo: first.customers[0].orderRefs[0].displayOrderNo, customerId: first.customers[0].muledgerCustomerId,
    customerMark: first.customers[0].customerSnapshot.mark + '-' + run, customerName: first.customers[0].customerSnapshot.name });
  const receipt = await db.receipt.findFirstOrThrow({ where: { receiptNo: 'R2-' + run } });
  assert.equal(receipt.orderId, a.id); assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).orderBalance), 6300);
  const frozenReceipt = JSON.stringify(receipt);
  const edit = async (amount, invNo = 'INV-LOCAL-' + run) => request('/api/invoice', 'PUT', {
    action: 'updateOrder', orderId: a.id, invNo, orderNo: 'AB-LOCAL-' + run, amount, customerId: a.customerId,
  });
  await edit(9800);
  assert.equal((await deliver(first)).result, 'DUPLICATE');
  let current = await load();
  assert.equal(current.invNo, 'INV-LOCAL-' + run);
  assert.equal(current.orders.find((row) => row.id === a.id).orderBalance, 5800);
  record('local invoice/order rename preserves identity; duplicate delivery preserves edit');
  const intent = { requestId: randomUUID(), expectedRevision: current.source.revision };
  await request('/api/invoice/' + invoiceId + '/resync', 'POST', intent);
  assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).amount), 10300);
  await edit(9700);
  await request('/api/invoice/' + invoiceId + '/resync', 'POST', intent);
  assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).amount), 9700);
  await request('/api/invoice/' + invoiceId + '/resync', 'POST', { ...intent, requestId: randomUUID() }, 409);
  record('manual restore and intent retry idempotency; stale revision conflicts');
  assert.equal((await deliver(second)).result, 'APPLIED');
  assert.equal((await deliver(third)).result, 'APPLIED');
  assert.equal((await deliver(second)).result, 'DUPLICATE');
  const altered = structuredClone(third); altered.invoiceNo = 'OTHER';
  await deliver(altered, 409);
  assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).orderBalance), 6000);
  await edit(3000);
  assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).orderBalance), -1000);
  assert.equal(JSON.stringify(await db.receipt.findUnique({ where: { id: receipt.id } })), frozenReceipt);
  record('new same-version and changed-version generations, stale/hash checks, negative balance and immutable receipt');
  current = await load();
  const revision = current.source.revision;
  const notices = await db.emailNotification.count();
  const audits = await db.auditLog.count({ where: { action: { in: ['MUCONT_INVOICE_APPLY', 'MUCONT_INVOICE_LOCAL_EDIT', 'MUCONT_INVOICE_RESYNC'] } } });
  const oldFile = await fetch(base + '/api/invoice/' + invoiceId + '/bill-of-lading', { headers: { Cookie: cookie } });
  assert.equal(await oldFile.text(), 'test bill of lading 1');
  await control({ version: 2 });
  current = await load();
  assert.equal(current.releaseDate, '2026-11-02'); assert.equal(current.estimatedArrivalDate, '2026-11-01');
  assert.equal(current.source.revision, revision);
  assert.equal(await db.emailNotification.count(), notices);
  assert.equal(await db.auditLog.count({ where: { action: { in: ['MUCONT_INVOICE_APPLY', 'MUCONT_INVOICE_LOCAL_EDIT', 'MUCONT_INVOICE_RESYNC'] } } }), audits);
  const newFile = await fetch(base + '/api/invoice/' + invoiceId + '/bill-of-lading', { headers: { Cookie: cookie } });
  assert.equal(await newFile.text(), 'test bill of lading 2');
  await control({ unavailable: true });
  current = await load(); assert.equal(current.source.metadataStale, true); assert.equal(current.releaseDate, '2026-11-02');
  await control({ unavailable: false, version: 1 });
  current = await load(); assert.equal(current.releaseDate, '2026-11-02');
  record('metadata refresh/failure/late response; stable financial revision; current B/L URL; no notices');
  const partial = await login('invoice-r2-partial@example.test');
  const partialList = await request('/api/invoice?search=' + run, 'GET', undefined, 200, partial);
  const partialInvoice = partialList.result.data.find((row) => row.id === invoiceId);
  assert.equal(partialInvoice.orders.length, 1); assert.equal(partialInvoice.source.canResync, false); assert.equal(partialInvoice.source.revision, null);
  await request('/api/invoice/' + invoiceId + '/resync', 'POST', { requestId: randomUUID(), expectedRevision: revision }, 403, partial);
  await request('/api/invoice/' + invoiceId + '/bill-of-lading', 'GET', undefined, 403, partial);
  const outsider = await login('invoice-r2-outsider@example.test');
  await request('/api/invoice/' + invoiceId + '/bill-of-lading', 'GET', undefined, 404, outsider);
  record('partial-customer/full-invoice and cross-branch permission isolation');
  await request('/api/invoice', 'PUT', { action: 'updateInvoiceDates', invoiceId, shipDate: '2020-01-01' }, 409);
  await request('/api/invoice', 'PUT', { action: 'addOrder', invoiceId, orderNo: 'EXTRA-' + run, amount: 10, customerMark: 'MARK-A-' + run }, 409);
  await request('/api/invoice', 'POST', { invNo: current.invNo, orders: [{ orderNo: a.orderNo, amount: 10, customerMark: 'MARK-A-' + run }] }, 409);
  record('legacy date editing, add-order, incremental import protected');
  await request('/api/invoice', 'PUT', { action: 'rematch' });
  assert.equal(await db.mucontInvoiceGroup.count({ where: { invoiceBatchId: first.invoiceBatchId } }), 2);
  assert.equal(Number((await db.order.findUnique({ where: { id: a.id } })).amount), 3000);
  record('Rematch preserves source structure and legitimate local edits');
  const history = structuredClone(first);
  history.generationId += '-history'; history.invoiceBatchId += '-history'; history.invoiceNo += '-history';
  history.customers.forEach((group) => group.orderRefs.forEach((ref) => { ref.displayOrderNo += '-H'; }));
  const oldInvoice = await db.invoice.create({ data: { invNo: history.invoiceNo, createdBy: 'invoice-r2-admin',
    orders: { create: history.customers.map((group) => ({
      orderNo: group.orderRefs.map((ref) => ref.displayOrderNo).join('/'), amount: group.totalAmount,
      orderBalance: group.totalAmount, customerId: group.muledgerCustomerId, createdBy: 'invoice-r2-admin',
    })) } } });
  await control({ latest: history });
  const oldCount = await db.mucontInvoiceGeneration.count();
  const historyPreview = await request('/api/integrations/mucont/v1/invoice-history', 'POST', { action: 'preview', limit: 20 });
  const proposed = historyPreview.result.data.items[0];
  assert.equal(proposed.result, 'READY'); assert.equal(proposed.ledgerInvoiceId, oldInvoice.id);
  assert.equal(await db.mucontInvoiceGeneration.count(), oldCount);
  const historyApply = { action: 'apply', invoiceBatchId: history.invoiceBatchId, payloadHash: proposed.payloadHash };
  await request('/api/integrations/mucont/v1/invoice-history', 'POST', historyApply);
  await request('/api/integrations/mucont/v1/invoice-history', 'POST', historyApply);
  assert.equal(await db.order.count({ where: { invoiceId: oldInvoice.id } }), 2);
  const removedGroup = structuredClone(history);
  removedGroup.generationId += '-remove'; removedGroup.publicationSequence++;
  removedGroup.customers = [removedGroup.customers[0]]; removedGroup.invoiceTotal = removedGroup.customers[0].totalAmount;
  await deliver(removedGroup, 409);
  record('read-only historical preview, exact adoption, idempotent apply and structural conflict');
  await control({ latest: third, version: 2 });
  fs.mkdirSync('out/invoice-r2-isolated', { recursive: true });
  fs.writeFileSync('out/invoice-r2-isolated/acceptance.json', JSON.stringify({ run, invoiceId, snapshots, evidence, receiptId: receipt.id }, null, 2));
  console.log('ALL R2 API ACCEPTANCE CHECKS PASSED');
} finally { await db.$disconnect(); }
