import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

export const name = 'invoice-credit-insurance';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/trading_ledger_test');
  assert.equal(new URL(t.baseUrl).hostname, '127.0.0.1');
  const db = new PrismaClient();
  const prefix = t.unique('insurance');
  const password = 'Insurance-Test!2026';
  const email = key => prefix + '-' + key + '@example.test';
  const account = async (key, role, parentId) => (await t.createUser({
    email: email(key), password, role, parentId,
  })).data.data.id;
  const customer = (orderName, ownerId, companyName) => db.customer.create({
    data: { orderName, ownerId, createdBy: ownerId, companyName, name: 'Test',
      mark: orderName, normalizedMark: orderName.toLowerCase(), phone: '', city: '' },
  });
  try {
    await t.initAdmin();
    const root = (await t.loginAdmin()).data.data.id;
    const branch = await account('branch', 'ADMIN', root);
    const peer = await account('peer', 'ADMIN', root);
    const sales = await account('sales', 'SALES', branch);
    const user = await account('user', 'USER', sales);
    const legalName = prefix + '-shared-company';
    const buyer = await customer(prefix + '-BUYER', user, legalName);
    const insured = await customer(prefix + '-INSURED', peer, legalName);
    const invoice = await db.invoice.create({ data: {
      invNo: prefix, createdBy: peer, managedById: branch,
      orders: { create: { createdBy: peer, orderNo: prefix + '-01', customerId: buyer.id, amount: 100, orderBalance: 100 } },
      mucontSource: { create: { invoiceBatchId: prefix, metadataVersion: 1, metadataAvailability: 'available',
        metadata: { invoiceBatchId: prefix, availability: 'available', metadataVersion: 1, sourceUpdatedAt: new Date().toISOString(),
          departureDate: '2026-11-01', estimatedArrivalDate: null, releaseDate: null, billOfLading: null,
          creditInsurance: { creditRecordId: insured.id, companyName: legalName, sourceVersion: '1' } } } },
    } });
    const get = async expected => {
      const res = await t.request('GET', '/api/invoice?search=' + prefix, { expectedStatus: 200 });
      assert.match(res.headers.get('cache-control') || '', /no-store/);
      const row = res.data.data.find(r => r.id === invoice.id);
      assert.equal(row.orders.length, 1, 'even a denied viewer sees the whole financial invoice');
      assert.equal(Number(row.invAmount), 100);
      assert.equal(row.shipDate, '2026-11-01');
      assert.equal(Object.hasOwn(row.source, 'creditInsurance'), Boolean(expected));
      assert.equal(row.source.creditInsurance, expected);
      assert.ok(!res.text.includes(legalName) && !res.text.includes(insured.id));
      if (!expected) {
        const search = await t.request('GET', '/api/invoice?search=' + encodeURIComponent(insured.orderName), { expectedStatus: 200 });
        assert.ok(!search.data.data.some(r => r.id === invoice.id));
      }
    };
    await get(insured.orderName);
    await t.login(email('branch'), password); await get(insured.orderName);
    for (const key of ['peer', 'sales', 'user']) { await t.login(email(key), password); await get(undefined); }
    t.step('owning and parent ADMIN receive only the selected title; prior creator, SALES and USER cannot read or search it');
    await t.loginAdmin();
    await t.request('PUT', '/api/invoice', { json: { action: 'assignBranchAdmin', invoiceId: invoice.id, targetAdminId: peer }, expectedStatus: 200 });
    await get(insured.orderName);
    await t.login(email('branch'), password); await get(undefined);
    await t.login(email('peer'), password); await get(insured.orderName);
    t.step('reassignment revokes the former ADMIN despite buyer visibility and grants the new ADMIN');
    await db.customer.update({ where: { id: insured.id }, data: { orderName: prefix + '-NEW' } });
    await get(prefix + '-NEW');
    await db.customer.delete({ where: { id: insured.id } });
    await get(undefined);
    t.step('uses the current primary ORDER NAME and never substitutes the other same-name company when the heading is gone');
  } finally {
    await db.$disconnect();
  }
}
