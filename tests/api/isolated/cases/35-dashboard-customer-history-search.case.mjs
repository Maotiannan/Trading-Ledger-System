export const name = 'dashboard-customer-history-search';

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('dashboard-history');
  const salesAEmail = `${suffix}-sales-a@example.com`;
  const salesBEmail = `${suffix}-sales-b@example.com`;
  const userAEmail = `${suffix}-user-a@example.com`;

  const salesA = await t.createUser({
    email: salesAEmail,
    password: 'SalesA@2026!',
    role: 'SALES',
    name: `Sales A ${suffix}`,
  });
  const salesAId = String(salesA.data?.data?.id || '');
  t.assertOk(Boolean(salesAId), 'sales A created');

  const salesB = await t.createUser({
    email: salesBEmail,
    password: 'SalesB@2026!',
    role: 'SALES',
    name: `Sales B ${suffix}`,
  });
  const salesBId = String(salesB.data?.data?.id || '');
  t.assertOk(Boolean(salesBId), 'sales B created');

  const userA = await t.createUser({
    email: userAEmail,
    password: 'UserA@2026!',
    role: 'USER',
    name: `User A ${suffix}`,
    parentId: salesAId,
  });
  t.assertOk(Boolean(userA.data?.data?.id), 'user A created under sales A');

  const primaryOrderName = `MAB${suffix}`.toUpperCase();
  const aliasOrderName = `MARY${suffix}`.toUpperCase();
  const mark = `MARK${suffix}`.toUpperCase();
  const customerName = `Mamadou Search ${suffix}`;
  const orderNo = `${primaryOrderName}-01`;
  const invoiceNo = `INV-${suffix}`.toUpperCase();

  const visibleCustomer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark,
      orderName: primaryOrderName,
      orderNames: [primaryOrderName, aliasOrderName],
      name: customerName,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesAId,
    },
    expectedStatus: 200,
  });
  const visibleCustomerId = String(visibleCustomer.data?.data?.id || '');
  t.assertOk(Boolean(visibleCustomerId), 'sales A customer created with multiple ORDER_NAME values');

  const hiddenMark = `HIDDEN${suffix}`.toUpperCase();
  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: hiddenMark,
      orderName: `OTHER${suffix}`.toUpperCase(),
      name: `Mamadou Search Hidden ${suffix}`,
      phone: `621${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesBId,
    },
    expectedStatus: 200,
  });
  t.step('sibling branch customer created');

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNo,
      orders: [{ orderNo, amount: 1000, customerMark: mark, customerName: primaryOrderName }],
    },
    expectedStatus: 200,
  });
  t.step('finance order created for visible customer');

  await t.logout();
  await t.login(userAEmail, 'UserA@2026!');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}`.toUpperCase(),
      usd: 250,
      orderNo,
      customerMark: mark,
      customerName: primaryOrderName,
    },
    expectedStatus: 200,
  });
  t.step('user-created receipt gives user visibility to the linked customer');

  const userSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(mark)}`,
    { expectedStatus: 200 },
  );
  const userRows = Array.isArray(userSearch.data?.data?.items) ? userSearch.data.data.items : [];
  t.assertEqual(userRows.length, 1, 'USER can use Dashboard customer search within own visible data');
  t.assertEqual(userRows[0]?.customerId, visibleCustomerId, 'USER search resolves the linked visible customer');
  t.assertEqual(userRows[0]?.orderNames?.includes(aliasOrderName), true, 'search result includes every customer ORDER_NAME');

  const spacedMarkSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(mark.toLowerCase().split('').join(' '))}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(spacedMarkSearch.data?.data?.items?.length, 1, 'exact MARK search ignores case and spaces');
  t.assertEqual(spacedMarkSearch.data?.data?.items?.[0]?.customerId, visibleCustomerId, 'normalized MARK resolves the same customer');

  const spacedOrderNameSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(aliasOrderName.toLowerCase().split('').join(' '))}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(spacedOrderNameSearch.data?.data?.items?.length, 1, 'exact ORDER_NAME search ignores case and spaces');
  t.assertEqual(spacedOrderNameSearch.data?.data?.items?.[0]?.customerId, visibleCustomerId, 'normalized ORDER_NAME resolves the same customer');

  const hiddenSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(hiddenMark)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(hiddenSearch.data?.data?.items?.length || 0, 0, 'USER cannot search a sibling branch customer');

  const userHistory = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=history&customerId=${encodeURIComponent(visibleCustomerId)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(userHistory.data?.data?.receipts?.length, 1, 'USER history includes the visible receipt');
  t.assertEqual(userHistory.data?.data?.orderNames?.includes(aliasOrderName), true, 'USER history keeps all customer ORDER_NAME values');

  await t.logout();
  await t.login(salesAEmail, 'SalesA@2026!');

  const salesSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(`Mamadou Search ${suffix}`.toLowerCase())}`,
    { expectedStatus: 200 },
  );
  const salesRows = Array.isArray(salesSearch.data?.data?.items) ? salesSearch.data.data.items : [];
  t.assertEqual(salesRows.length, 1, 'partial NAME search returns every matching visible customer only');
  t.assertEqual(salesRows[0]?.customerId, visibleCustomerId, 'partial NAME search excludes sibling branch matches');

  const orderSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(orderNo)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(orderSearch.data?.data?.items?.[0]?.customerId, visibleCustomerId, 'exact ORDER NO search uses the shared order matcher');

  const salesHistory = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=history&customerId=${encodeURIComponent(visibleCustomerId)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(salesHistory.data?.data?.orders?.length, 1, 'SALES history includes the customer finance order');
  t.assertEqual(salesHistory.data?.data?.receipts?.length, 1, 'SALES history includes descendant receipts');

  await t.logout();

  await t.loginAdmin();
  const adminSearch = await t.request(
    'GET',
    `/api/dashboard/customer-history-search?action=search&query=${encodeURIComponent(`Mamadou Search`)}`,
    { expectedStatus: 200 },
  );
  const adminRows = Array.isArray(adminSearch.data?.data?.items) ? adminSearch.data.data.items : [];
  t.assertEqual(adminRows.length, 2, 'ADMIN can search customers across both managed branches');
  t.assertEqual(adminRows.some((row) => row.customerId === visibleCustomerId), true, 'ADMIN results include the sales A customer');
  t.assertEqual(adminRows.some((row) => row.mark === hiddenMark), true, 'ADMIN results include the sales B customer');
  await t.logout();
}
