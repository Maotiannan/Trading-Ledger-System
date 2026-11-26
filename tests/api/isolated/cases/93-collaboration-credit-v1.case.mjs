import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export const name = 'collaboration-credit-v1';
const base = '/api/integrations/collaboration/v1/credit-records';

async function verifyMigrationAndRestore(db, suffix, seedIds) {
  const schemaName = `collab_credit_${suffix.slice(-18)}`;
  const restoredName = `${schemaName}_restored`;
  assert.match(schemaName, /^collab_credit_[a-z0-9]+$/i);
  const url = new URL(process.env.DATABASE_URL);
  let source;
  let restored;
  let created = false;
  let restoredCreated = false;
  const quote = value => '`' + value.replaceAll('`', '``') + '`';
  try {
    // Names are unique to this synthetic fixture; no IF EXISTS/DROP of somebody else's database.
    await db.$executeRawUnsafe(`CREATE DATABASE ${quote(schemaName)}`);
    created = true;
    await db.$executeRawUnsafe(`CREATE TABLE ${quote(schemaName)}.Customer LIKE Customer`);
    await db.$executeRawUnsafe(`ALTER TABLE ${quote(schemaName)}.Customer DROP COLUMN companyContact`);
    const columns = (await db.$queryRawUnsafe("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Customer' AND COLUMN_NAME <> 'companyContact' ORDER BY ORDINAL_POSITION")).map(row => row.name);
    const fields = columns.map(quote).join(',');
    const marks = seedIds.map(() => '?').join(',');
    await db.$executeRawUnsafe(`INSERT INTO ${quote(schemaName)}.Customer (${fields}) SELECT ${fields} FROM Customer WHERE id IN (${marks})`, ...seedIds);
    url.pathname = '/' + schemaName;
    source = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const before = await source.$queryRawUnsafe(`SELECT ${fields} FROM Customer ORDER BY id`);
    const migration = readFileSync('prisma/migrations/20261103090000_collaboration_company_contact/migration.sql', 'utf8');
    await source.$executeRawUnsafe(migration);
    const after = await source.$queryRawUnsafe(`SELECT ${fields} FROM Customer ORDER BY id`);
    assert.deepEqual(after, before, 'all pre-existing fields are unchanged by the exact additive SQL');
    assert.equal(await source.customer.count({ where: { companyContact: { not: null } } }), 0);
    const text = 'Synthetic company desk\n+000 123 / bureau@example.invalid';
    await source.customer.update({ where: { id: seedIds[0] }, data: { companyContact: text } });
    const snapshot = await source.customer.findMany({ orderBy: { id: 'asc' } });

    await db.$executeRawUnsafe(`CREATE DATABASE ${quote(restoredName)}`);
    restoredCreated = true;
    const dockerArgs = ['compose', '-p', 'trading-ledger-system-test', '-f', 'docker-compose.test.yml', 'exec', '-T', 'mysql'];
    const dump = execFileSync('docker', [...dockerArgs, 'mariadb-dump', '-uroot', '-prootpass', '--single-transaction', schemaName], { maxBuffer: 8 * 1024 * 1024 });
    execFileSync('docker', [...dockerArgs, 'mariadb', '-uroot', '-prootpass', restoredName], { input: dump, maxBuffer: 1024 * 1024 });
    url.pathname = '/' + restoredName;
    restored = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    assert.deepEqual(await restored.customer.findMany({ orderBy: { id: 'asc' } }), snapshot);
    assert.equal((await restored.customer.findUniqueOrThrow({ where: { id: seedIds[0] } })).companyContact, text);
    return { comparedOriginalFields: columns.length, fixtureRows: before.length, newValuesInitiallyNull: true, originalFieldsUnchanged: true, dumpBytes: dump.length, dumpSha256: createHash('sha256').update(dump).digest('hex'), restoredRowsAndNewContactEqual: true };
  } finally {
    await source?.$disconnect();
    await restored?.$disconnect();
    if (restoredCreated) await db.$executeRawUnsafe(`DROP DATABASE ${quote(restoredName)}`);
    if (created) await db.$executeRawUnsafe(`DROP DATABASE ${quote(schemaName)}`);
  }
}

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '3307');
  assert.equal(url.pathname, '/trading_ledger_test');
  const db = new PrismaClient();
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync('docs/integrations/collaboration-v1/credit-records.schema.json', 'utf8')));
  const credential = process.env.COLLABORATION_CREDIT_READ_TOKEN;
  assert.ok(credential?.startsWith('isolated-'));
  const get = async (path, status = 200, token = credential) => {
    const r = await t.request('GET', base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, expectedStatus: status });
    assert.equal(validate(r.data), true, JSON.stringify(validate.errors));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-collaboration-contract'), 'credit-records/1.0.0');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    return r.data;
  };
  try {
    await t.initAdmin();
    const login = await t.loginAdmin();
    const adminId = login.data.data.id;
    const suffix = t.unique('cc').replaceAll('-', '').toLowerCase();
    const prefix = `000-collab-${suffix}`;
    const owner = await db.user.create({ data: { email: `${suffix}@example.invalid`, password: 'not-a-login-hash', role: 'SALES', level: 3 } });
    const ids = Array.from({ length: 57 }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);
    const seed = id => ({ id, mark: 'SYNTHETIC', normalizedMark: 'synthetic', orderName: 'DEMO', name: 'PRIVATE CUSTOMER', phone: 'PRIVATE PHONE', city: 'PRIVATE CITY', companyName: 'Same Company', createdBy: adminId, ownerId: adminId });
    await db.customer.createMany({ data: ids.map((id, i) => ({ ...seed(id), ownerId: i % 2 ? owner.id : adminId, credit: new Prisma.Decimal(i === 0 ? '9007199254740993.01' : '123.45') })) });
    const emptyId = `${prefix}-unset`;
    const zeroId = `${prefix}-zero`;
    const negativeId = `${prefix}-negative`;
    await db.customer.createMany({ data: [
      { ...seed(emptyId), companyName: null, credit: null },
      { ...seed(zeroId), credit: new Prisma.Decimal('0.00') },
      { ...seed(negativeId), credit: new Prisma.Decimal('-1.00') },
    ] });

    assert.equal((await get('', 401, null)).error.code, 'AUTH_REQUIRED'); // ADMIN cookie is insufficient.
    assert.equal((await get('', 401, 'wrong')).error.code, 'AUTH_INVALID');
    assert.equal((await get('', 401, process.env.MUCONT_CUSTOMERS_READ_TOKEN)).error.code, 'AUTH_INVALID');
    const factory = await t.request('GET', base, { headers: { Cookie: 'factory_session=synthetic' }, expectedStatus: 401 });
    assert.equal(factory.data.error.code, 'AUTH_REQUIRED');
    for (const query of ['?limit=0', '?limit=1.5', '?limit=2&limit=3', '?ownerId=someone']) assert.equal((await get(query, 400)).error.code, 'INVALID_QUERY');
    assert.equal((await get('?cursor=forged', 400)).error.code, 'INVALID_CURSOR');
    t.step('dedicated credential required; staff/browser and existing service tokens do not grant credit read');

    const defaultPage = await get('');
    assert.equal(defaultPage.items.length, 20);
    const first = await get('?limit=5');
    assert.deepEqual(first.items.map(r => r.creditRecordId), ids.slice(0, 5));
    assert.equal(first.items[0].creditAmount, '9007199254740993.01');
    assert.equal(first.items[0].contacts.details, null);
    assert.equal(first.items[0].address, null);
    assert.equal(first.items[0].companyName, first.items[1].companyName);
    assert.ok(!JSON.stringify(first).match(/PRIVATE|ownerId|customerId|orderBalance|createdBy/));
    const before = await db.customer.findUniqueOrThrow({ where: { id: ids[0] } });
    const record = await get('/' + ids[0]);
    assert.equal(record.creditRecordId, ids[0]);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ids[0] } })).updatedAt.toISOString(), before.updatedAt.toISOString());
    assert.equal((await get('/' + emptyId)).creditState, 'UNSET');
    assert.equal((await get('/' + zeroId)).creditState, 'ZERO');
    assert.equal((await get('/' + negativeId)).creditState, 'INVALID');
    t.step('precise decimal strings, duplicate company names, missing contacts and null/zero/legacy-negative semantics');

    // Remove the cursor's record, remove an unread record, add before and after cursor.
    await db.customer.deleteMany({ where: { id: { in: [ids[4], ids[6]] } } });
    const earlyId = `${prefix}-000a`;
    const lateId = `${prefix}-004a`;
    await db.customer.createMany({ data: [earlyId, lateId].map(id => ({ ...seed(id), credit: new Prisma.Decimal('0.01') })) });
    const seen = first.items.map(r => r.creditRecordId);
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor) {
      const page = await get('?' + new URLSearchParams({ limit: '7', cursor }));
      seen.push(...page.items.filter(r => r.creditRecordId.startsWith(prefix)).map(r => r.creditRecordId));
      cursor = page.nextCursor;
      pages++;
      assert.equal(page.hasMore, cursor !== null);
    }
    assert.ok(pages > 1);
    assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(seen, [...ids.filter(id => id !== ids[6]), lateId].sort());
    assert.ok((await get('?limit=50')).items.some(r => r.creditRecordId === earlyId));
    assert.ok(!(await get('?limit=50')).items.some(r => [emptyId, zeroId, negativeId].includes(r.creditRecordId)));
    assert.equal((await get('/' + ids[4], 404)).error.code, 'CREDIT_RECORD_NOT_FOUND');
    t.step('multi-page current traversal survives cursor deletion without duplicates; before-cursor addition appears next traversal');

    await db.customer.update({ where: { id: ids[0] }, data: { ownerId: owner.id, credit: new Prisma.Decimal('0.00') } });
    const cancelled = await get('/' + ids[0]);
    assert.equal(cancelled.creditState, 'ZERO');
    assert.notEqual(cancelled.sourceVersion, record.sourceVersion);
    await db.customer.update({ where: { id: ids[0] }, data: { credit: null } });
    assert.equal((await get('/' + ids[0])).creditAmount, null);
    const oldV1 = await t.request('GET', '/api/integrations/mucont/v1/customers/' + ids[0], { headers: { Authorization: `Bearer ${process.env.MUCONT_CUSTOMERS_READ_TOKEN}` }, expectedStatus: 200 });
    assert.equal(oldV1.data.customerId, ids[0]);
    assert.ok(!('credit' in oldV1.data.profile));
    assert.ok(!('companyContact' in oldV1.data.profile));
    const rejectInOldV1 = await t.request('GET', '/api/integrations/mucont/v1/customers/options', { headers: { Authorization: `Bearer ${credential}` }, expectedStatus: 401 });
    assert.equal(rejectInOldV1.data.error.code, 'AUTH_INVALID');
    const withoutCookie = await fetch(new URL('/api/customer', t.baseUrl), { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update', id: ids[0], companyName: 'NOT ALLOWED' }) });
    assert.equal(withoutCookie.status, 401);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await t.request(method, base + '/' + ids[0], { headers: { Authorization: `Bearer ${credential}` }, expectedStatus: 405 });
    }
    t.step('cancellation and ownership do not replace stable ID; old V1 and write endpoints retain their original scopes');

    const manual = await t.request('POST', '/api/customer', { json: { action: 'create', mark: suffix, orderName: suffix, name: 'Synthetic maintainer', phone: suffix, city: 'Synthetic City', companyName: 'Synthetic maintained insurer ' + suffix, credit: 12.34, customerCode: 'C-SYNTHETIC', creditCode: 'CR-SYNTHETIC', companyAddress: 'Synthetic company address', companyContact: 'Synthetic insurer desk' }, expectedStatus: 200 });
    const manualId = manual.data.data.id;
    assert.equal((await get('/' + manualId)).contacts.details, 'Synthetic insurer desk');
    const stored = await db.customer.findUniqueOrThrow({ where: { id: manualId } });
    const legacyPayload = { action: 'update', id: manualId, mark: stored.mark, orderName: stored.orderName, name: stored.name, phone: stored.phone, city: stored.city, companyName: stored.companyName, companyAddress: stored.companyAddress, credit: '12.34' };
    await t.request('POST', '/api/customer', { json: legacyPayload, expectedStatus: 200 });
    assert.equal((await get('/' + manualId)).contacts.details, 'Synthetic insurer desk');
    await t.request('POST', '/api/customer', { json: { ...legacyPayload, companyContact: null }, expectedStatus: 200 });
    assert.equal((await get('/' + manualId)).contacts.details, null);
    t.step('existing customer create/edit maintain the new nullable contact; old clients preserve it, explicit null clears it');

    const migrationEvidence = await verifyMigrationAndRestore(db, suffix, [ids[0], ids[1], emptyId, zeroId]);
    console.log('[collaboration migration/restore]', JSON.stringify(migrationEvidence));
    t.step('exact additive migration preserves every original Customer field and isolated dump/restore preserves the new contact');

    const previousMax = await db.systemSetting.findUnique({ where: { key: 'EXCEL_LOOKUP_RATE_LIMIT_MAX' } });
    try {
      await t.request('POST', '/api/settings', { json: { action: 'update-config', settings: { EXCEL_LOOKUP_RATE_LIMIT_MAX: '2' } }, expectedStatus: 200 });
      await t.resetRateLimits();
      await get('');
      await get('');
      const limited = await get('', 429);
      assert.equal(limited.error.code, 'RATE_LIMITED');
      assert.ok(limited.error.retryAfterMs > 0);
      const old = await t.request('GET', '/api/integrations/mucont/v1/customers/options', { headers: { Authorization: `Bearer ${process.env.MUCONT_CUSTOMERS_READ_TOKEN}` }, expectedStatus: 200 });
      assert.ok(Array.isArray(old.data.items));
      t.step('real HTTP rate limit triggers 429 with a separate bucket from existing customer V1');
    } finally {
      await t.request('POST', '/api/settings', { json: { action: 'update-config', settings: { EXCEL_LOOKUP_RATE_LIMIT_MAX: previousMax?.value || '240' } }, expectedStatus: 200 });
      await t.resetRateLimits();
    }
  } finally {
    await db.$disconnect();
  }
}
