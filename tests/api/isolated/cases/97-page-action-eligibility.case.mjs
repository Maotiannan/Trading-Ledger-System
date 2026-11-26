import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

export const name = 'page-action-eligibility';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/trading_ledger_test');
  assert.equal(new URL(t.baseUrl).hostname, '127.0.0.1');
  const db = new PrismaClient();
  const prefix = t.unique('actions');
  const password = 'Local-Fixture!243';
  const post = (path, json, expectedStatus = 200) => t.request('POST', '/api/' + path, { json, expectedStatus });
  try {
    await t.initAdmin();
    const root = (await t.loginAdmin()).data.data.id;
    const account = async (name, role, parentId) => (await t.createUser({
      name, role, parentId, email: prefix + '-' + name + '@example.test', password,
    })).data.data.id;
    const branch = await account('branch', 'ADMIN', root);
    const sales = await account('sales', 'SALES', branch);
    const customerFields = { mark: prefix, orderName: prefix, name: prefix, phone: '600000000', city: 'Test' };
    const created = await post('customer', { action: 'create', ...customerFields, consignee: 'Receiver A' });
    const customerId = created.data.data.id;
    await post('customer', { action: 'consignee-add', customerId, consignee: 'Receiver B' });
    await post('customer', { action: 'update', id: customerId, ...customerFields, city: 'Updated' });
    await post('customer', { action: 'update', id: customerId, ...customerFields, consignee: 'Receiver B' }, 400);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).consignee, 'Receiver A');
    const other = await db.customerConsignee.findFirstOrThrow({ where: { customerId, consignee: 'Receiver B' } });
    await post('customer', { action: 'consignee-set-primary', customerId, consigneeId: other.id });
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).consignee, 'Receiver B');

    const invoice = await db.invoice.create({ data: {
      invNo: prefix, createdBy: root,
      orders: { create: { orderNo: prefix + '-01', customerId, customerPhone: '600000000', amount: 310, orderBalance: 0, createdBy: root } },
      mucontSource: { create: { invoiceBatchId: prefix } },
    }, include: { orders: true } });
    const order = invoice.orders[0];
    await db.mucontInvoiceGroup.create({ data: {
      invoiceBatchId: prefix, billingGroupId: prefix, orderId: order.id, customerId, orderRefs: [],
    } });
    await t.request('PUT', '/api/invoice', { expectedStatus: 409,
      json: { action: 'updateOrder', orderId: order.id, customerPhone: 'changed', amount: 999 } });
    const clear = await t.request('PUT', '/api/invoice', { expectedStatus: 409,
      json: { action: 'updateOrder', orderId: order.id, customerPhone: null, amount: 999 } });
    assert.match(clear.data.error.message, /read-only/);
    assert.equal(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).amount), 310);

    await db.receipt.createMany({ data: Array.from({ length: 31 }, (_, i) => ({
      receiptNo: prefix + '-r' + i, usd: 10, status: 'SR_Received', orderId: order.id, createdBy: root,
    })) });
    const read = async page => (await t.request('GET', '/api/invoice?orderId=' + order.id + '&pageSize=30&page=' + page, { expectedStatus: 200 })).data;
    const first = await read(1), second = await read(2);
    assert.equal(first.pagination.totalItems, 31);
    assert.equal(new Set([...first.data, ...second.data].map(r => r.id)).size, 31);
    assert.equal(second.data.length, 1);

    const receipt = await db.receipt.create({ data: { createdBy: sales, usd: 20, status: 'Bank_Transfer' } });
    const detail = await db.detail.create({ data: { createdBy: sales, totalAmount: 100, status: 'RECEIVED' } });
    const swift = await db.swift.create({ data: { createdBy: sales, detailId: detail.id, amount: 100, status: 'RECEIVED' } });
    await t.login(prefix + '-sales@example.test', password);
    const receiptBlocked = await post('receipt', { action: 'request-edit', receiptId: receipt.id, data: {
      receiptNo: prefix + '-edit', date: '2026-11-24', orderNo: prefix, invNo: prefix,
      customerMark: prefix, payer: 'Test', tel: '600000000',
    } }, 400);
    assert.equal(receiptBlocked.data.detail?.status, 'Bank_Transfer');
    assert.equal(await db.receiptEditRequest.count({ where: { receiptId: receipt.id } }), 0);

    await t.login(prefix + '-branch@example.test', password);
    const deletionBlocked = await post('deletion', { action: 'request', targetType: 'DETAIL', targetId: detail.id, reason: 'test' }, 400);
    assert.equal(deletionBlocked.data.code, 'DELETION_NOT_ALLOWED');
    for (const [kind, target] of [['detail', detail], ['swift', swift]]) {
      const model = db[kind + 'EditRequest'];
      const key = kind === 'detail' ? 'pendingDetailId' : 'pendingSwiftId';
      const snapshot = kind === 'detail'
        ? { date: null, agentId: null, items: [{ mark: prefix, orderNo: prefix, amount: 100, receiptId: null }] }
        : { date: null, amount: 100, senderName: prefix, senderAddress: null, receiverName: null, receiverAccount: null };
      const request = await model.create({ data: {
        [kind + 'Id']: target.id, [key]: target.id, requestedBy: sales,
        beforeSnapshot: snapshot, afterSnapshot: { ...snapshot, date: '2026-11-24' },
      } });
      const list = await post(kind, { action: 'list-edit-requests' });
      assert.equal(list.data.data.find(row => row.id === request.id)?.approvalBlocked, true);
      await post(kind, { action: 'review-edit', requestId: request.id, decision: 'approve' }, 400);
      assert.equal((await model.findUniqueOrThrow({ where: { id: request.id } })).status, 'PENDING');
      await post(kind, { action: 'review-edit', requestId: request.id, decision: 'reject' });
      const closed = await model.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(closed.status, 'REJECTED');
      assert.equal(closed[key], null);
      assert.equal((await db[kind].findUniqueOrThrow({ where: { id: target.id } })).status, 'RECEIVED');
    }
    assert.equal(await db.deletionRequest.count({ where: { targetId: detail.id } }), 0);
  } finally {
    await db.$disconnect();
  }
}
