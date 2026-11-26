import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { PUT } from '@/app/api/invoice/route';
import { POST as conflicts } from '@/app/api/integrations/mucont/v2/order-conflicts/route';
import { createSessionToken, getSessionCookieName } from '@/lib/session';
import { renameInvoiceRecord } from '@/lib/invoice-rename-service';
import { renameInvoiceNumber } from '@/lib/invoice-number';
import { runFinancialTransaction } from '@/lib/transaction';
import type { CurrentUser } from '@/lib/request-auth';

const prefix = `invoice-ui-${Date.now()}`;
let sequence = 0;
const id = () => `${prefix}-${++sequence}`;
let admin: CurrentUser;
let outsider: CurrentUser;
let sales: CurrentUser;
const token = 'isolated-invoice-ui-token-'.padEnd(48, 'x');
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '3313' || url.pathname !== '/muledger_prepayment_20261111') throw new Error('Isolated invoice database required');
  admin = await db.user.findUniqueOrThrow({ where: { id: 'prepay-admin' } });
  outsider = await db.user.create({ data: { email: `${id()}@example.test`, password: 'synthetic-not-login', role: 'ADMIN', level: 1 } });
  sales = await db.user.create({ data: { email: `${id()}@example.test`, password: 'synthetic-not-login', role: 'SALES', parentId: admin.id, level: 2 } });
  process.env.MUCONT_INVOICE_ACTOR_ID = admin.id;
  process.env.MUCONT_INVOICE_RECEIVE_TOKEN = token;
});
afterAll(async () => { await db.$disconnect(); });
const request = (data: unknown, user?: CurrentUser, locale = 'en') => new NextRequest('http://localhost/api/invoice', {
  method: 'PUT', headers: { 'Content-Type': 'application/json', 'Accept-Language': locale,
    ...(user ? { cookie: `${getSessionCookieName()}=${createSessionToken(user.id)}` } : {}) }, body: JSON.stringify(data),
});
async function fixture(owner = admin, source = false) {
  const name = id();
  const customer = await db.customer.create({ data: { mark: name, normalizedMark: name, name, orderName: name,
    phone: '', city: '', ownerId: owner.id, createdBy: owner.id } });
  const invoice = await db.invoice.create({ data: { invNo: name, createdBy: owner.id } });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: `${name}-ORDER`, customerId: customer.id,
    amount: 5000, orderBalance: 4800, paymentAllocationMode: source, createdBy: owner.id } });
  const receipt = await db.receipt.create({ data: { orderId: order.id, orderNo: order.orderNo, invNo: invoice.invNo,
    customerId: customer.id, usd: 200, status: 'RECEIVED', imageUrl: '/upload/test-unchanged.png', createdBy: owner.id } });
  const history = await db.receiptHistory.create({ data: { receiptId: receipt.id, invNo: invoice.invNo, usd: 200, status: 'RECEIVED', createdBy: owner.id } });
  const session = await db.receiptGeneratorSession.create({ data: { receiptId: receipt.id, receiptNo: name, orderNo: order.orderNo,
    invNo: invoice.invNo, usd: 200, createdBy: owner.id, layoutSnapshot: { invNo: invoice.invNo }, status: 'FINALIZED' } });
  const batch = id();
  if (source) {
    await db.mucontInvoiceSource.create({ data: { invoiceBatchId: batch, invoiceId: invoice.id } });
    await db.mucontInvoiceGroup.create({ data: { invoiceBatchId: batch, billingGroupId: id(), orderId: order.id,
      customerId: customer.id, orderRefs: [{ sourceOrderNo: order.orderNo, displayOrderNo: order.orderNo }] } });
  }
  return { invoice, order, receipt, history, session, batch };
}

test.each([false, true])('real API whole rename keeps identities, balances, files and snapshots (source=%s)', async source => {
  const f = await fixture(admin, source); const next = id();
  const fundingBefore = await db.receiptFunding.count();
  const r = await PUT(request({ action: 'renameInvoice', invoiceId: f.invoice.id, expectedInvNo: f.invoice.invNo, invNo: next }, admin));
  expect(r.status).toBe(200);
  expect((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).invNo).toBe(next);
  expect(await db.order.findUnique({ where: { id: f.order.id } })).toEqual(f.order);
  const receipt = await db.receipt.findUniqueOrThrow({ where: { id: f.receipt.id } });
  expect({ ...receipt, invNo: f.receipt.invNo, updatedAt: f.receipt.updatedAt }).toEqual(f.receipt);
  expect(receipt.invNo).toBe(next);
  expect(await db.receiptHistory.findUnique({ where: { id: f.history.id } })).toEqual(f.history);
  expect(await db.receiptGeneratorSession.findUnique({ where: { id: f.session.id } })).toEqual(f.session);
  expect(await db.receiptFunding.count()).toBe(fundingBefore);
  expect((await db.auditLog.findFirstOrThrow({ where: { action: 'INVOICE_RENAMED', targetId: f.invoice.id } })).metadata)
    .toMatchObject({ before: { invNo: f.invoice.invNo }, after: { invNo: next }, receiptCount: 1 });
  if (source) expect((await db.mucontInvoiceSource.findUniqueOrThrow({ where: { invoiceBatchId: f.batch } })).invoiceId).toBe(f.invoice.id);
});
test('real endpoint denies unauthenticated, SALES and an unrelated administrator', async () => {
  const f = await fixture();
  const body = { action: 'renameInvoice', invoiceId: f.invoice.id, expectedInvNo: f.invoice.invNo, invNo: id() };
  expect((await PUT(request(body))).status).toBe(401);
  expect((await PUT(request(body, sales))).status).toBe(403);
  expect((await PUT(request(body, outsider))).status).toBe(404);
  expect(await db.invoice.findUnique({ where: { id: f.invoice.id } })).toEqual(f.invoice);
});
test('duplicate number and concurrent stale edits cannot partially update receipts', async () => {
  const f = await fixture(); const other = await fixture();
  const body = { action: 'renameInvoice', invoiceId: f.invoice.id, expectedInvNo: f.invoice.invNo, invNo: other.invoice.invNo };
  const duplicate = await PUT(request(body, admin));
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error).toContain('occupied');
  expect(await db.receipt.findUnique({ where: { id: f.receipt.id } })).toEqual(f.receipt);
  const next = id();
  const results = await Promise.all([renameInvoiceRecord(admin, { ...body, invNo: next }), renameInvoiceRecord(admin, { ...body, invNo: id() })].map(p => p.then(() => 200, e => e.status)));
  expect(results.sort()).toEqual([200, 409]);
  expect(await db.auditLog.count({ where: { action: 'INVOICE_RENAMED', targetId: f.invoice.id } })).toBe(1);
});
test('transaction rolls invoice and receipt labels back together on a later failure', async () => {
  const f = await fixture();
  await expect(runFinancialTransaction(async tx => { await renameInvoiceNumber(tx, f.invoice, id()); throw new Error('synthetic audit failure'); })).rejects.toThrow('synthetic audit failure');
  expect(await db.invoice.findUnique({ where: { id: f.invoice.id } })).toEqual(f.invoice);
  expect(await db.receipt.findUnique({ where: { id: f.receipt.id } })).toEqual(f.receipt);
});
test('pending signature draft follows the new invoice number while finalized history stays frozen', async () => {
  const f = await fixture();
  await db.receiptGeneratorSession.update({ where: { id: f.session.id }, data: { status: 'PENDING' } });
  const next = id();
  await renameInvoiceRecord(admin, { invoiceId: f.invoice.id, expectedInvNo: f.invoice.invNo, invNo: next });
  expect((await db.receiptGeneratorSession.findUniqueOrThrow({ where: { id: f.session.id } })).invNo).toBe(next);
  expect(await db.receiptHistory.findUnique({ where: { id: f.history.id } })).toEqual(f.history);
});
test('read-only API excludes pools, current source and inaccessible orders, returns original-only hints', async () => {
  const f = await fixture(); const own = await fixture(admin, true); const hidden = await fixture(outsider);
  const poolInvoice = await db.invoice.findUniqueOrThrow({ where: { invNo: 'DEPOSIT_POOL' } });
  const pool = await db.order.create({ data: { invoiceId: poolInvoice.id, orderNo: id(), amount: 0, createdBy: admin.id } });
  const rows = [f.order, own.order, hidden.order, pool];
  const body = { invoiceBatchId: own.batch, items: rows.map(row => ({ key: row.id, displayOrderNo: row.orderNo })) };
  const call = (credential?: string) => conflicts(new NextRequest('http://localhost/api/integrations/mucont/v2/order-conflicts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: 'Bearer ' + credential } : {}) }, body: JSON.stringify(body),
  }));
  expect((await call()).status).toBe(401);
  const beforeAudit = await db.auditLog.count();
  const response = await call(token); expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const result = await response.json();
  expect(result.items.map((row: { matches: unknown[] }) => row.matches.length)).toEqual([1, 0, 0, 0]);
  expect(await db.auditLog.count()).toBe(beforeAudit);
});
