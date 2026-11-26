import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const name = 'collaboration-credit-zero';
const base = '/api/integrations/collaboration/v2/credit-records';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '3307');
  assert.equal(url.pathname, '/trading_ledger_test');
  const token = process.env.COLLABORATION_CREDIT_READ_TOKEN;
  assert.ok(token?.startsWith('isolated-'));
  const db = new PrismaClient();
  const ids = [];
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync('docs/integrations/collaboration-v1/credit-records-v2.schema.json', 'utf8')));
  const get = async (query, expectedStatus = 200, credential = token) => {
    const result = await t.request('GET', `${base}?${query}`, {
      headers: credential ? { Authorization: `Bearer ${credential}` } : {}, expectedStatus,
    });
    assert.equal(result.headers.get('x-collaboration-contract'), 'credit-records/2.0.0');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(validate(result.data), true, JSON.stringify(validate.errors));
    return result.data;
  };
  const pages = async includeZero => {
    const records = [];
    let cursor;
    do {
      const params = new URLSearchParams({ limit: '2', ...(includeZero === undefined ? {} : { includeZero: String(includeZero) }), ...(cursor ? { cursor } : {}) });
      const page = await get(params);
      assert.equal(page.hasMore, page.nextCursor !== null);
      assert.ok(page.items.length <= 2);
      records.push(...page.items);
      cursor = page.nextCursor;
      assert.ok(records.length < 100, 'Unexpected isolated page loop');
    } while (cursor);
    return records;
  };
  try {
    await t.initAdmin();
    const adminId = (await t.loginAdmin()).data.data.id;
    for (const credit of ['0.00', '0.00', '10.25', '9007199254740993.01', null, '-1.00']) {
      const key = t.unique('credit-zero');
      const row = await db.customer.create({ data: {
        mark: key, normalizedMark: key, name: 'Synthetic customer', orderName: key.toUpperCase(),
        phone: '+000 123', city: 'Synthetic', companyName: 'Synthetic company', credit,
        ownerId: adminId, createdBy: adminId,
      } });
      ids.push(row.id);
    }
    const snapshot = () => db.customer.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const before = await snapshot();
    const defaults = await pages();
    assert.ok(defaults.every(r => r.creditState === 'AVAILABLE'));
    assert.deepEqual(await pages(false), defaults);
    assert.deepEqual(defaults.filter(r => ids.includes(r.creditRecordId)).map(r => r.creditRecordId),
      before.filter(r => r.credit?.gt(0)).map(r => r.id));
    const all = await pages(true);
    assert.deepEqual(all.filter(r => ids.includes(r.creditRecordId)).map(r => [r.creditRecordId, r.creditAmount]),
      before.filter(r => r.credit?.gte(0)).map(r => [r.id, r.credit.toFixed(2)]));
    assert.equal(new Set(all.map(r => r.creditRecordId)).size, all.length);
    assert.ok(all.every(r => ['AVAILABLE', 'ZERO'].includes(r.creditState)));
    assert.ok(all.filter(r => r.creditState === 'ZERO').every(r => r.creditAmount === '0.00'));
    t.step('real GET pagination includes explicit zeros only on opt-in; null and negative excluded; default and exact decimals preserved');

    const zeroFirst = await get('includeZero=true&limit=1');
    const defaultFirst = await get('limit=1');
    for (const query of [new URLSearchParams({ cursor: zeroFirst.nextCursor }),
      new URLSearchParams({ includeZero: 'true', cursor: defaultFirst.nextCursor })]) {
      assert.equal((await get(query, 400)).error.code, 'INVALID_CURSOR');
    }
    for (const query of ['includeZero=1', 'includeZero=', 'includeZero=true&includeZero=false', 'includeZero=true&factoryId=other']) {
      assert.equal((await get(query, 400)).error.code, 'INVALID_QUERY');
    }
    for (const credential of [null, 'wrong', process.env.COLLABORATION_CREDIT_WRITE_TOKEN]) await get('includeZero=true', 401, credential);
    const v1 = await t.request('GET', '/api/integrations/collaboration/v1/credit-records?limit=50', {
      headers: { Authorization: `Bearer ${token}` }, expectedStatus: 200,
    });
    assert.ok(v1.data.items.every(r => r.creditState === 'AVAILABLE'));
    assert.deepEqual(await snapshot(), before);
    t.step('filter-bound cursors, query validation and read credential enforced; V1 and all source rows unchanged');
  } finally {
    await db.customer.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}
