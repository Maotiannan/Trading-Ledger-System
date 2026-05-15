export const name = 'customer-sync';

function findById(rows, id) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.id === id);
}

export default async function run(t) {
  await t.initAdmin();
  const login = await t.loginAdmin();
  const adminId = String(login.data?.data?.id || '');
  t.assertOk(Boolean(adminId), 'admin id available for customer sync');

  const suffix = t.unique('sync-customer');
  const salesEmail = `${suffix}-sales@example.com`;
  const userEmail = `${suffix}-user@example.com`;
  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sync Sales ${suffix}`,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'sync sales account created');

  await t.createUser({
    email: userEmail,
    password: 'User@2026!',
    role: 'USER',
    name: `Sync User ${suffix}`,
    parentId: salesId,
  });
  t.step('sync user account created');

  const customer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: `SYNC-${suffix}`,
      orderName: `SYNC-${suffix}`,
      orderNames: [`SYNC-${suffix}-ALT`],
      name: `Sync Customer ${suffix}`,
      phone: `623${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      companyName: `Sync Company ${suffix}`,
      companyAddress: 'Conakry Address',
      credit: 12345,
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  const customerId = String(customer.data?.data?.id || '');
  t.assertOk(Boolean(customerId), 'sync customer created');

  const initialSync = await t.request('GET', '/api/sync/customers', { expectedStatus: 200 });
  const initialRows = Array.isArray(initialSync.data?.data?.customers) ? initialSync.data.data.customers : [];
  const initialCustomer = findById(initialRows, customerId);
  t.assertOk(Boolean(initialCustomer), 'initial customer sync includes created customer');
  t.assertOk(Array.isArray(initialCustomer?.orderNames) && initialCustomer.orderNames.includes(`SYNC-${suffix}-ALT`), 'initial customer sync includes order name aliases');
  t.assertEqual(initialCustomer?.syncState, 'UPSERT', 'initial customer sync marks customer as upsert');
  const initialCursor = String(initialSync.data?.data?.nextCursor || '');
  t.assertOk(Boolean(initialCursor), 'initial customer sync returns next cursor');

  await t.request('POST', '/api/customer', {
    json: {
      action: 'update',
      id: customerId,
      mark: `SYNC-${suffix}`,
      orderName: `SYNC-${suffix}`,
      orderNames: [`SYNC-${suffix}-ALT`],
      name: `Sync Customer Updated ${suffix}`,
      phone: customer.data.data.phone,
      city: 'Conakry',
      companyName: `Sync Company Updated ${suffix}`,
      companyAddress: 'Updated Address',
      credit: 23456,
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.step('sync customer updated');

  const incrementalSync = await t.request('GET', `/api/sync/customers?since=${encodeURIComponent(initialCursor)}`, { expectedStatus: 200 });
  const incrementalRows = Array.isArray(incrementalSync.data?.data?.customers) ? incrementalSync.data.data.customers : [];
  const changedCustomer = findById(incrementalRows, customerId);
  t.assertEqual(changedCustomer?.name, `Sync Customer Updated ${suffix}`, 'incremental customer sync returns updated customer');
  t.assertEqual(changedCustomer?.companyName, `Sync Company Updated ${suffix}`, 'incremental customer sync keeps admin-visible extended fields');
  const updateCursor = String(incrementalSync.data?.data?.nextCursor || '');
  t.assertOk(Boolean(updateCursor), 'incremental customer sync returns next cursor');

  await t.request('POST', '/api/customer', {
    json: { action: 'delete', id: customerId },
    expectedStatus: 200,
  });
  t.step('sync customer deleted');

  const deleteSync = await t.request('GET', `/api/sync/customers?since=${encodeURIComponent(updateCursor)}`, { expectedStatus: 200 });
  const deleteRows = Array.isArray(deleteSync.data?.data?.deleted) ? deleteSync.data.data.deleted : [];
  const tombstone = findById(deleteRows, customerId);
  t.assertEqual(tombstone?.syncState, 'DELETED', 'customer sync returns delete tombstone');
  t.assertEqual(tombstone?.ownerId, salesId, 'customer delete tombstone keeps owner id');

  await t.logout();
  await t.login(userEmail, 'User@2026!');
  const userDenied = await t.request('GET', '/api/sync/customers', { expectedStatus: 403 });
  t.assertEqual(userDenied.data?.code, 'FORBIDDEN', 'user role cannot use customer sync');

  await t.logout();
}
