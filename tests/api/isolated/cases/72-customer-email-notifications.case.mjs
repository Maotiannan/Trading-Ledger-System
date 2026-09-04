export const name = 'customer-email-notifications';

function rows(response) {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('customer-email');
  const salesAEmail = `${suffix}-sales-a@example.com`;
  const salesBEmail = `${suffix}-sales-b@example.com`;
  const userAEmail = `${suffix}-user-a@example.com`;
  const salesA = await t.createUser({
    email: salesAEmail,
    password: 'SalesA@2026!',
    role: 'SALES',
    name: `Email Sales A ${suffix}`,
  });
  const salesAId = String(salesA.data?.data?.id || '');
  const salesB = await t.createUser({
    email: salesBEmail,
    password: 'SalesB@2026!',
    role: 'SALES',
    name: `Email Sales B ${suffix}`,
  });
  const salesBId = String(salesB.data?.data?.id || '');
  await t.createUser({
    email: userAEmail,
    password: 'UserA@2026!',
    role: 'USER',
    name: `Email User A ${suffix}`,
    parentId: salesAId,
  });
  t.assertOk(Boolean(salesAId && salesBId), 'independent SALES branches created');

  const orderNameA = `EMAIL-A-${suffix}`.toUpperCase();
  const markA = `EA-${suffix}`.toUpperCase();
  const customerA = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: markA,
      orderName: orderNameA,
      name: `Email Customer A ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesAId,
    },
    expectedStatus: 200,
  });
  const customerAId = String(customerA.data?.data?.id || '');

  const customerB = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: `EB-${suffix}`.toUpperCase(),
      orderName: `EMAIL-B-${suffix}`.toUpperCase(),
      name: `Email Customer B ${suffix}`,
      phone: `621${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesBId,
    },
    expectedStatus: 200,
  });
  const customerBId = String(customerB.data?.data?.id || '');
  t.assertOk(Boolean(customerAId && customerBId), 'scoped customers created');

  const receiptNo = `EMAIL-MISSING-${suffix}`.toUpperCase();
  const orderNo = `${orderNameA}-01`;
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo,
      date: '2026-09-01',
      usd: 1250,
      orderNo,
      invNo: null,
      customerId: customerAId,
      customerMark: markA,
      customerName: `Email Customer A ${suffix}`,
      isDeposit: false,
    },
    expectedStatus: 200,
  });

  const missingBefore = await t.request(
    'GET',
    `/api/email-notifications?search=${encodeURIComponent(receiptNo)}&status=MISSING_RECIPIENT`,
    { expectedStatus: 200 },
  );
  const missingTask = rows(missingBefore).find((row) => row.receiptNo === receiptNo);
  t.assertEqual(missingTask?.status, 'MISSING_RECIPIENT', 'receipt without an address creates a missing-recipient task');

  await t.logout();
  await t.login(userAEmail, 'UserA@2026!');
  const userListDenied = await t.request(
    'GET',
    `/api/customer-notification-emails?customerId=${encodeURIComponent(customerAId)}`,
    { expectedStatus: 403 },
  );
  t.assertEqual(userListDenied.data?.code, 'FORBIDDEN', 'USER cannot read customer notification contacts');
  const userWriteDenied = await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'add', customerId: customerAId, email: `${suffix}-blocked@example.com` },
    expectedStatus: 403,
  });
  t.assertEqual(userWriteDenied.data?.code, 'FORBIDDEN', 'USER cannot add customer notification contacts');

  await t.logout();
  await t.login(salesAEmail, 'SalesA@2026!');
  const ownEmpty = await t.request(
    'GET',
    `/api/customer-notification-emails?customerId=${encodeURIComponent(customerAId)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(rows(ownEmpty).length, 0, 'SALES can read its visible customer contact profile');

  const otherBranchRead = await t.request(
    'GET',
    `/api/customer-notification-emails?customerId=${encodeURIComponent(customerBId)}`,
    { expectedStatus: 404 },
  );
  t.assertEqual(otherBranchRead.data?.code, 'RESOURCE_NOT_FOUND', 'SALES cannot read another branch customer contacts');
  const otherBranchWrite = await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'add', customerId: customerBId, email: `${suffix}-cross-branch@example.com` },
    expectedStatus: 404,
  });
  t.assertEqual(otherBranchWrite.data?.code, 'RESOURCE_NOT_FOUND', 'SALES cannot mutate another branch customer contacts');

  const firstAddress = `${suffix}-primary@example.com`;
  const secondAddress = `${suffix}-accounts@example.com`;
  const first = await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'add', customerId: customerAId, email: firstAddress },
    expectedStatus: 200,
  });
  const firstId = String(first.data?.data?.id || '');
  t.assertEqual(first.data?.data?.isPrimary, true, 'first customer address becomes primary');
  const second = await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'add', customerId: customerAId, email: secondAddress },
    expectedStatus: 200,
  });
  const secondId = String(second.data?.data?.id || '');
  t.assertEqual(second.data?.data?.isPrimary, false, 'second customer address starts as additional');

  await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'set-primary', customerId: customerAId, emailId: secondId },
    expectedStatus: 200,
  });
  const updatedFirstAddress = `${suffix}-office@example.com`;
  await t.request('POST', '/api/customer-notification-emails', {
    json: {
      action: 'update',
      customerId: customerAId,
      emailId: firstId,
      email: updatedFirstAddress,
    },
    expectedStatus: 200,
  });
  await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'update-language', customerId: customerAId, language: 'FRENCH' },
    expectedStatus: 200,
  });

  const maintained = await t.request(
    'GET',
    `/api/customer-notification-emails?customerId=${encodeURIComponent(customerAId)}`,
    { expectedStatus: 200 },
  );
  const maintainedRows = rows(maintained);
  t.assertEqual(maintained.data?.language, 'FRENCH', 'SALES can set the customer language preference to French');
  t.assertEqual(maintainedRows.length, 2, 'both customer addresses are retained');
  t.assertEqual(maintainedRows[0]?.id, secondId, 'selected address is returned as primary');
  t.assertEqual(maintainedRows[0]?.isPrimary, true, 'selected address remains primary');
  t.assertOk(maintainedRows.some((row) => row.email === updatedFirstAddress), 'address update is persisted');

  const salesEmailManagementDenied = await t.request('GET', '/api/email-notifications', { expectedStatus: 403 });
  t.assertEqual(salesEmailManagementDenied.data?.code, 'FORBIDDEN', 'SALES cannot access Email Management APIs');

  await t.logout();
  await t.loginAdmin();
  const pendingAfter = await t.request(
    'GET',
    `/api/email-notifications?search=${encodeURIComponent(receiptNo)}&status=PENDING`,
    { expectedStatus: 200 },
  );
  const recoveredTask = rows(pendingAfter).find((row) => row.id === missingTask?.id);
  t.assertEqual(recoveredTask?.status, 'PENDING', 'adding an address restores the existing task to pending approval');
  t.assertEqual(recoveredTask?.language, 'FRENCH', 'task view follows the current customer language preference');

  await t.logout();
}
