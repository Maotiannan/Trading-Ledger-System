import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const name = 'mucont-customers-v1';
const base = '/api/integrations/mucont/v1/customers';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/trading_ledger_test');
  const db = new PrismaClient();
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync('docs/integrations/mucont-customers-v1.schema.json', 'utf8')));
  const credential = process.env.MUCONT_CUSTOMERS_READ_TOKEN;
  const get = async (path, status = 200, token = credential) => {
    const result = await t.request('GET', base + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, expectedStatus: status,
    });
    assert.equal(validate(result.data), true, JSON.stringify(validate.errors));
    assert.equal(result.headers.get('cache-control'), 'no-store');
    return result.data;
  };
  try {
    await t.initAdmin();
    const login = await t.loginAdmin();
    const adminId = login.data.data.id;
    const suffix = t.unique('v2').replaceAll('-', '');
    const mark = `V2MARK${suffix}`;
    const owner = await db.user.create({ data: { email: `${suffix}@example.invalid`, password: 'not-a-login-hash', role: 'SALES', level: 3 } });
    const ids = Array.from({ length: 53 }, (_, i) => `fixture-${suffix}-${String(i).padStart(3, '0')}`);
    await db.customer.createMany({ data: ids.map((id, i) => ({
      id, mark, normalizedMark: mark.toLowerCase(), name: 'Same Display Name',
      orderName: `NAME${i}${suffix}`, phone: '', city: '', createdBy: adminId, ownerId: i % 2 ? owner.id : adminId,
    })) });
    await db.customerOrderName.createMany({ data: [
      { customerId: ids[0], orderName: 'Alias Match One', normalizedOrderName: `alias${suffix}one` },
      { customerId: ids[0], orderName: 'Alias Match Two', normalizedOrderName: `alias${suffix}two` },
    ] });
    await db.customerConsignee.create({ data: {
      customerId: ids[0], consignee: 'Current Receiver', normalizedConsignee: 'current receiver',
      normalizedConsigneeHash: createHash('sha256').update('current receiver').digest('hex'), isPrimary: true,
    } });

    assert.equal((await get('/options', 401, null)).error.code, 'AUTH_REQUIRED');
    assert.equal((await get('/options', 401, 'wrong-service-token')).error.code, 'AUTH_INVALID');
    assert.equal((await get('/options?limit=0', 400)).error.code, 'INVALID_QUERY');
    const defaultPage = await get('/options');
    assert.equal(defaultPage.items.length, 20);
    let cursor = null;
    const seen = [];
    do {
      const params = new URLSearchParams({ q: mark, limit: '20' });
      if (cursor) params.set('cursor', cursor);
      const page = await get(`/options?${params}`);
      seen.push(...page.items.map((item) => item.customerId));
      cursor = page.nextCursor;
      assert.equal(page.hasMore, cursor !== null);
    } while (cursor);
    assert.deepEqual(seen, ids);
    t.step('53 customers across unrelated owners paginate exactly once despite duplicate names and MARK');

    const first = await get(`/options?${new URLSearchParams({ q: mark, limit: '1' })}`);
    assert.equal((await get(`/options?${new URLSearchParams({ q: 'different', cursor: first.nextCursor })}`, 400)).error.code, 'INVALID_CURSOR');
    assert.equal((await get('/options?cursor=forged', 400)).error.code, 'INVALID_CURSOR');
    assert.equal((await get(`/options?${new URLSearchParams({ q: `alias${suffix}` })}`)).items.length, 1);
    assert.equal((await get(`/options?${new URLSearchParams({ q: mark, limit: '500' })}`)).items.length, 50);
    t.step('search covers aliases, cursor is query-bound, maximum batch size is 50');

    const before = await db.customer.findUniqueOrThrow({ where: { id: ids[0] } });
    const initial = await get(`/${ids[0]}`);
    assert.equal(initial.completeness, 'MASTER_FULL');
    assert.equal(initial.profile.consignee, 'Current Receiver');
    assert.deepEqual(initial.profile.consignees, ['Current Receiver']);
    assert.equal(initial.profile.companyAddress, null);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ids[0] } })).updatedAt.toISOString(), before.updatedAt.toISOString());
    await db.customer.update({ where: { id: ids[0] }, data: { ownerId: owner.id, companyAddress: 'Updated snapshot address', name: 'Updated customer name' } });
    const latest = await get(`/${ids[0]}`);
    assert.equal(latest.customerId, initial.customerId);
    assert.equal(latest.profile.companyAddress, 'Updated snapshot address');
    assert.equal(latest.profile.name, 'Updated customer name');
    assert.equal((await get(`/options?${new URLSearchParams({ q: 'Updated customer name' })}`)).items[0].customerId, ids[0]);
    assert.equal(initial.profile.companyAddress, null);
    t.step('ID read returns latest complete committed profile after owner transfer; previous snapshot stays unchanged');

    await db.customer.delete({ where: { id: ids.at(-1) } });
    assert.equal((await get(`/${ids.at(-1)}`, 404)).error.code, 'CUSTOMER_NOT_FOUND');
    t.step('deleted identity returns explicit 404 without name fallback');

    const excel = await t.request('POST', '/api/excel/token', { json: { action: 'generate', name: 'V2 legacy compatibility' }, expectedStatus: 200 });
    const legacyToken = excel.data.data.token;
    assert.equal((await get('/options', 401, legacyToken)).error.code, 'AUTH_INVALID');
    const legacyReject = await t.request('POST', '/api/sync/customers/by-orders', {
      headers: { Authorization: `Bearer ${credential}` }, json: { orderNos: ['ANY-01'] }, expectedStatus: 401,
    });
    assert.ok(legacyReject.data.code.startsWith('EXCEL_TOKEN_'));
    const inv = await db.invoice.create({ data: { invNo: `V2-INV-${suffix}`, createdBy: adminId } });
    const fullOrder = `DEMO${suffix}-01/DEMO${suffix}-02`;
    await db.order.create({ data: { invoiceId: inv.id, orderNo: fullOrder, amount: 100, createdBy: adminId, customerId: ids[2] } });
    const aliasOrder = await db.order.create({ data: {
      invoiceId: inv.id, orderNo: `DEMO${suffix}-01/DEMO${suffix}-03`, amount: 200, createdBy: adminId, customerId: ids[4],
    } });
    await db.orderAlias.create({ data: { orderId: aliasOrder.id, aliasNo: `demo${suffix}-01`.toLowerCase() } });
    const lookup = await t.request('POST', '/api/sync/customers/by-orders', {
      headers: { Authorization: `Bearer ${legacyToken}` }, json: { orderNos: [fullOrder] }, expectedStatus: 200,
    });
    assert.equal(lookup.data.data.results[0].success, true);
    assert.equal(lookup.data.data.results[0].customerId, ids[2]);
    t.step('credentials are not interchangeable and legacy by-orders prefers complete order over another customer alias');
  } finally {
    await db.$disconnect();
  }
}
