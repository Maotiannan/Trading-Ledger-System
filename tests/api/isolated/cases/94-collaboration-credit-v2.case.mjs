import assert from 'node:assert/strict';
import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const name = 'collaboration-credit-v2';
const base = '/api/integrations/collaboration/v2/credit-records';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '3307');
  assert.equal(url.pathname, '/trading_ledger_test');
  const db = new PrismaClient();
  const readToken = process.env.COLLABORATION_CREDIT_READ_TOKEN;
  const writeToken = process.env.COLLABORATION_CREDIT_WRITE_TOKEN;
  const principalId = process.env.COLLABORATION_CREDIT_WRITE_ACTOR_ID;
  assert.ok(readToken?.startsWith('isolated-') && writeToken?.startsWith('isolated-'));
  assert.equal(principalId, 'isolated-collaboration-write-principal');
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync('docs/integrations/collaboration-v1/credit-records-v2.schema.json', 'utf8')));
  const call = async (method, path, json, expectedStatus = 200, token = method === 'GET' ? readToken : writeToken) => {
    const result = await t.request(method, base + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, json, expectedStatus,
    });
    assert.equal(result.headers.get('x-collaboration-contract'), 'credit-records/2.0.0');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(validate(result.data), true, JSON.stringify(validate.errors));
    return result.data;
  };
  const suffix = t.unique('v2').replaceAll('-', '');
  const trigger = `collab_audit_${suffix}`;
  let customerId, invoiceId, peerId;
  try {
    await t.initAdmin();
    const adminId = (await t.loginAdmin()).data.data.id;
    await db.user.create({ data: { id: principalId, email: `${suffix}@example.invalid`, password: 'not-a-login-hash', role: 'ADMIN', level: 1 } });
    const customer = await db.customer.create({ data: {
      mark: suffix, normalizedMark: suffix, name: 'Synthetic customer', orderName: 'SYNTHETIC ' + suffix,
      phone: '+000 123', city: 'Synthetic', credit: new Prisma.Decimal('9007199254740993.01'),
      companyName: 'Synthetic buyer', ownerId: adminId, createdBy: adminId,
    } });
    customerId = customer.id;
    peerId = (await db.customer.create({ data: {
      mark: suffix + 'PEER', normalizedMark: suffix + 'peer', name: 'Synthetic peer', orderName: 'PEER ' + suffix,
      phone: '+000 124', city: 'Synthetic', credit: '1.00', ownerId: adminId, createdBy: adminId,
    } })).id;
    await db.customerOrderName.createMany({ data: [
      { customerId, orderName: customer.orderName, normalizedOrderName: customer.orderName.replaceAll(' ', ''), isPrimary: true },
      { customerId, orderName: 'SECONDARY ' + suffix, normalizedOrderName: 'SECONDARY' + suffix, isPrimary: false },
    ] });
    const invoice = await db.invoice.create({ data: { invNo: 'SYNTHETIC-' + suffix, createdBy: adminId } });
    invoiceId = invoice.id;
    const order = await db.order.create({ data: { invoiceId, orderNo: customer.orderName + '-01', amount: '1000.00', orderBalance: '750.00', customerId, createdBy: adminId } });
    await db.receipt.create({ data: { receiptNo: 'SYNTHETIC-' + suffix, orderId: order.id, customerId, usd: '250.00', createdBy: adminId, status: 'SR_Received' } });
    const financialState = async () => ({ orders: await db.order.findMany({ where: { invoiceId } }), receipts: await db.receipt.findMany({ where: { customerId } }) });
    const financialBefore = await financialState();
    let record = await call('GET', '/' + customerId);
    assert.equal(record.creditAmount, '9007199254740993.01');
    assert.equal(record.phone, customer.phone);
    assert.equal(record.orderName, customer.orderName);
    assert.ok(record.missingFields.includes('customerCode'));
    const body = (fields, version = record.sourceVersion, requestId = t.unique('write')) => ({
      requestId, expectedSourceVersion: version, confirmation: 'MODIFY_WRITEBACK_CONFIRM',
      actor: { id: 'synthetic-mucont-user', name: 'Synthetic user' }, fields,
    });
    await call('POST', '/' + customerId + '/writeback', body({ companyName: 'Missing codes' }), 400);
    for (const token of [null, 'wrong', readToken, process.env.MUCONT_CUSTOMERS_READ_TOKEN]) {
      await call('POST', '/' + customerId + '/writeback', body({ customerCode: '001', creditCode: '002' }), 401, token);
    }
    await call('GET', '', undefined, 401, writeToken);
    const v1 = await t.request('GET', '/api/integrations/collaboration/v1/credit-records/' + customerId, { headers: { Authorization: 'Bearer ' + readToken }, expectedStatus: 200 });
    assert.equal(v1.headers.get('x-collaboration-contract'), 'credit-records/1.0.0');
    for (const field of ['customerCode', 'creditCode', 'phone', 'orderName']) assert.equal(Object.hasOwn(v1.data, field), false);
    const page = await call('GET', '?limit=1');
    assert.ok(page.nextCursor);
    await t.request('GET', '/api/integrations/collaboration/v1/credit-records?cursor=' + encodeURIComponent(page.nextCursor), { headers: { Authorization: 'Bearer ' + readToken }, expectedStatus: 400 });
    assert.deepEqual(await db.customer.findUniqueOrThrow({ where: { id: customerId } }), customer);
    t.step('V2 fields and exact decimal; V1 unchanged; dedicated read/write credentials and cursor domains; reads never write');

    const firstBody = body({ customerCode: '001', creditCode: '002', orderName: 'changed ' + suffix,
      phone: '+000 456', companyName: 'Changed buyer ' + suffix, address: 'New address', creditAmount: '1234.56', currency: 'USD' });
    const first = await call('POST', '/' + customerId + '/writeback', firstBody);
    record = first.record;
    assert.equal(first.written, true);
    assert.equal(record.orderName, firstBody.fields.orderName.toUpperCase());
    assert.equal(record.creditRecordId, customerId);
    assert.equal(record.phone, '+000 456');
    assert.equal(record.creditAmount, '1234.56');
    assert.equal(record.address, 'New address');
    assert.equal(record.customerCode, '001');
    assert.equal(record.creditCode, '002');
    assert.deepEqual(await call('GET', '/' + customerId), record);
    const currentCustomer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(currentCustomer.ownerId, customer.ownerId);
    assert.equal(currentCustomer.createdBy, customer.createdBy);
    const aliases = await db.customerOrderName.findMany({ where: { customerId } });
    assert.equal(aliases.filter(a => a.isPrimary).length, 1);
    assert.ok(aliases.some(a => a.isPrimary && a.orderName === record.orderName));
    assert.ok(aliases.some(a => !a.isPrimary && a.orderName === 'SECONDARY ' + suffix));
    assert.deepEqual(await financialState(), financialBefore);
    const audit = await db.auditLog.findUniqueOrThrow({ where: { id: first.auditId } });
    assert.equal(audit.actorId, principalId);
    assert.equal(audit.metadata.externalActor.id, firstBody.actor.id);
    assert.equal(audit.metadata.requestId, firstBody.requestId);
    assert.equal(audit.metadata.before.creditAmount, '9007199254740993.01');
    assert.deepEqual(audit.metadata.after, record);
    assert.deepEqual(await call('POST', '/' + customerId + '/writeback', firstBody), first);
    await call('POST', '/' + customerId + '/writeback', { ...firstBody, fields: { phone: '+000 999' } }, 409);
    await call('POST', '/' + customerId + '/writeback', body({ phone: '+000 999' }, firstBody.expectedSourceVersion), 409);
    t.step('all eight writable fields; aliases and ownership preserved; linked financial rows untouched; audit and idempotency');

    const concurrentVersion = record.sourceVersion;
    const results = await Promise.all(['+000 701', '+000 702'].map(phone => t.request('POST', base + '/' + customerId + '/writeback', {
      headers: { Authorization: 'Bearer ' + writeToken }, json: body({ phone }, concurrentVersion),
    })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    record = await call('GET', '/' + customerId);
    const sameBody = body({ phone: '+000 703' });
    const same = await Promise.all([1, 2].map(() => call('POST', '/' + customerId + '/writeback', sameBody)));
    assert.deepEqual(same[0], same[1]);
    assert.equal(await db.auditLog.count({ where: { targetId: customerId, action: 'COLLABORATION_CREDIT_WRITEBACK' } }), 3);
    assert.deepEqual(await call('POST', '/' + customerId + '/writeback', firstBody), first);
    record = await call('GET', '/' + customerId);
    t.step('concurrent stale version rejected; concurrent same request writes once; replay remains original after newer edits');

    const beforeRollback = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const rollbackBody = body({ phone: '+000 800' });
    const intentsBefore = await db.mutationIntent.count({ where: { kind: 'COLLABORATION_CREDIT_WRITEBACK' } });
    await db.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON AuditLog FOR EACH ROW BEGIN IF NEW.action = 'COLLABORATION_CREDIT_WRITEBACK' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic audit failure'; END IF; END`);
    try { await call('POST', '/' + customerId + '/writeback', rollbackBody, 503); }
    finally { await db.$executeRawUnsafe(`DROP TRIGGER ${trigger}`); }
    assert.deepEqual(await db.customer.findUniqueOrThrow({ where: { id: customerId } }), beforeRollback);
    assert.equal(await db.mutationIntent.count({ where: { kind: 'COLLABORATION_CREDIT_WRITEBACK' } }), intentsBefore);
    await call('POST', '/' + customerId + '/writeback', rollbackBody);
    record = await call('GET', '/' + customerId);
    await db.user.update({ where: { id: principalId }, data: { disabledAt: new Date() } });
    await call('POST', '/' + customerId + '/writeback', body({ phone: '+000 900' }), 503);
    assert.equal((await call('GET', '/' + customerId)).sourceVersion, record.sourceVersion);
    await db.user.update({ where: { id: principalId }, data: { disabledAt: null } });
    const zero = await call('POST', '/' + customerId + '/writeback', body({ creditAmount: '0', customerCode: null, creditCode: null }));
    assert.equal(zero.record.creditState, 'ZERO');
    assert.equal(zero.record.customerCode, null);
    assert.deepEqual(await financialState(), financialBefore);
    t.step('audit failure rolls back customer and intent; retry succeeds; disabled principal denied; zero credit allows empty codes');
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
    if (customerId) {
      await db.auditLog.deleteMany({ where: { targetId: customerId, action: 'COLLABORATION_CREDIT_WRITEBACK' } });
      await db.receipt.deleteMany({ where: { customerId } });
      if (invoiceId) await db.invoice.delete({ where: { id: invoiceId } });
      await db.customer.delete({ where: { id: customerId } });
    }
    await db.mutationIntent.deleteMany({ where: { actorId: `collaboration:mucont:${principalId}` } });
    if (peerId) await db.customer.delete({ where: { id: peerId } });
    await db.user.deleteMany({ where: { id: principalId } });
    await db.$disconnect();
  }
}
