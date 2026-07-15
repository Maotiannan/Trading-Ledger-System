export const name = 'dashboard-customer-analytics';

const analyticsSettingKeys = [
  'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
  'CUSTOMER_ANALYTICS_NORMAL_DAYS',
  'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
  'CUSTOMER_ANALYTICS_DELAY_DAYS',
  'CUSTOMER_ANALYTICS_WARNING_DAYS',
  'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
  'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
];

function conakryDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Conakry',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function dateInput(value) {
  return value.toISOString().slice(0, 10);
}

function metricUrl(metric, year) {
  const params = new URLSearchParams({ action: 'ranking', metric });
  if (metric === 'annual-amount') params.set('year', String(year));
  return `/api/dashboard/customer-analytics?${params.toString()}`;
}

function detailUrl(metric, customerId, year, asOf) {
  const params = new URLSearchParams({ action: 'detail', metric, customerId });
  if (metric === 'annual-amount') params.set('year', String(year));
  if (asOf) params.set('asOf', String(asOf));
  return `/api/dashboard/customer-analytics?${params.toString()}`;
}

function items(response) {
  return Array.isArray(response.data?.data?.items) ? response.data.data.items : [];
}

function findCustomerRow(response, customerId) {
  return items(response).find((row) => row.customerId === customerId);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('customer-analytics');
  const salesAEmail = `${suffix}-sales-a@example.com`;
  const salesBEmail = `${suffix}-sales-b@example.com`;
  const userAEmail = `${suffix}-user-a@example.com`;

  const salesA = await t.createUser({
    email: salesAEmail,
    password: 'SalesA@2026!',
    role: 'SALES',
    name: `Analytics Sales A ${suffix}`,
  });
  const salesAId = String(salesA.data?.data?.id || '');
  t.assertOk(Boolean(salesAId), 'analytics sales A created');

  const salesB = await t.createUser({
    email: salesBEmail,
    password: 'SalesB@2026!',
    role: 'SALES',
    name: `Analytics Sales B ${suffix}`,
  });
  const salesBId = String(salesB.data?.data?.id || '');
  t.assertOk(Boolean(salesBId), 'analytics sales B created');

  const userA = await t.createUser({
    email: userAEmail,
    password: 'UserA@2026!',
    role: 'USER',
    name: `Analytics User A ${suffix}`,
    parentId: salesAId,
  });
  const userAId = String(userA.data?.data?.id || '');
  t.assertOk(Boolean(userAId), 'analytics user A created under sales A');

  const markA = `ANA-${suffix}-A`.toUpperCase();
  const markB = `ANA-${suffix}-B`.toUpperCase();
  const orderNameA = `ANAA${suffix}`.toUpperCase();
  const orderNameB = `ANAB${suffix}`.toUpperCase();
  const orderNoA = `${orderNameA}-01`;
  const orderNoB = `${orderNameB}-01`;
  const invoiceNoA = `INV-ANA-A-${suffix}`.toUpperCase();
  const invoiceNoB = `INV-ANA-B-${suffix}`.toUpperCase();

  const customerA = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: markA,
      orderName: orderNameA,
      name: `Analytics Customer A ${suffix}`,
      companyName: `Analytics Company A ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesAId,
    },
    expectedStatus: 200,
  });
  const customerAId = String(customerA.data?.data?.id || '');
  t.assertOk(Boolean(customerAId), 'visible analytics customer created under sales A');

  const customerB = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: markB,
      orderName: orderNameB,
      name: `Analytics Customer B ${suffix}`,
      companyName: `Analytics Company B ${suffix}`,
      phone: `621${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesBId,
    },
    expectedStatus: 200,
  });
  const customerBId = String(customerB.data?.data?.id || '');
  t.assertOk(Boolean(customerBId), 'hidden analytics customer created for sales B');

  const nowParts = conakryDateParts();
  const releaseDate = new Date(Date.UTC(nowParts.year, 0, 1));
  const shipDate = new Date(Date.UTC(nowParts.year - 1, 11, 31));
  const previousCompletedMonthDate = new Date(Date.UTC(nowParts.year, nowParts.month - 2, 15));

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNoB,
      shipDate: dateInput(shipDate),
      releaseDate: dateInput(releaseDate),
      orders: [{
        orderNo: orderNoB,
        amount: 50000,
        customerMark: markB,
        customerName: orderNameB,
        customerId: customerBId,
      }],
    },
    expectedStatus: 200,
  });
  t.step('customer B zero-payment invoice created in sibling branch');

  await t.logout();
  await t.login(userAEmail, 'UserA@2026!');

  const receiptAmount = 12000;
  const receipt = await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-ANA-${suffix}`.toUpperCase(),
      date: dateInput(previousCompletedMonthDate),
      usd: receiptAmount,
      orderNo: orderNoA,
      customerId: customerAId,
      customerMark: markA,
      customerName: orderNameA,
      isDeposit: true,
    },
    expectedStatus: 200,
  });
  const receiptId = String(receipt.data?.data?.id || '');
  const userCreatedOrderId = String(receipt.data?.data?.orderId || '');
  t.assertOk(Boolean(receiptId), 'one previous-completed-month deposit receipt created for customer A');
  t.assertOk(Boolean(userCreatedOrderId), 'USER A receipt creates its visible finance order before invoice assignment');

  await t.logout();
  await t.loginAdmin();

  const assignedOrder = await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateOrder',
      orderId: userCreatedOrderId,
      invNo: invoiceNoA,
      orderNo: orderNoA,
      amount: 100000,
      customerMark: markA,
      customerName: orderNameA,
      customerId: customerAId,
    },
    expectedStatus: 200,
  });
  const invoiceAId = String(assignedOrder.data?.data?.invoiceId || '');
  t.assertOk(Boolean(invoiceAId), 'ADMIN assigns the USER-created order to a formal invoice');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateInvoiceDates',
      invoiceId: invoiceAId,
      shipDate: dateInput(shipDate),
      releaseDate: dateInput(releaseDate),
    },
    expectedStatus: 200,
  });
  t.step('customer A invoice uses a current-year release date independently of ship date');

  await t.logout();
  await t.login(userAEmail, 'UserA@2026!');

  const annualUser = await t.request('GET', metricUrl('annual-amount', nowParts.year), { expectedStatus: 200 });
  const annualUserRow = findCustomerRow(annualUser, customerAId);
  t.assertEqual(items(annualUser).length, 1, 'USER A annual ranking contains only its visible customer');
  t.assertEqual(annualUserRow?.value, 100000, 'annual ranking uses the current-year release date and invoice amount');
  t.assertEqual(annualUser.data?.data?.totalVisibleCustomers, 1, 'USER A analytics scope excludes sibling customers');

  const capacityUser = await t.request('GET', metricUrl('payment-capacity'), { expectedStatus: 200 });
  const capacityUserRow = findCustomerRow(capacityUser, customerAId);
  const lookbackMonths = Number(capacityUser.data?.data?.settings?.lookbackMonths || 0);
  t.assertEqual(lookbackMonths > 0, true, 'capacity response exposes the server lookback setting');
  t.assertEqual(
    capacityUserRow?.value,
    Number((receiptAmount / lookbackMonths).toFixed(2)),
    'capacity divides the previous completed-month payment by the configured completed-month count',
  );

  const cycleUser = await t.request('GET', metricUrl('payment-cycle'), { expectedStatus: 200 });
  const cycleUserRow = findCustomerRow(cycleUser, customerAId);
  t.assertEqual(items(cycleUser).length, 1, 'USER A cycle ranking remains visibility scoped');
  t.assertEqual(Number(cycleUserRow?.roundedDays || 0) > 0, true, 'partial payment leaves a nonzero weighted payment cycle');
  t.assertEqual(Number(cycleUserRow?.overdueOutstanding || 0) > 0, true, 'partial payment exposes overdue open balance');

  const annualDetail = await t.request(
    'GET',
    detailUrl('annual-amount', customerAId, nowParts.year, annualUser.data?.data?.asOf),
    { expectedStatus: 200 },
  );
  t.assertEqual(annualDetail.data?.data?.value, annualUserRow?.value, 'annual detail value reconciles with its ranking row');
  t.assertEqual(annualDetail.data?.data?.detail?.total, annualUserRow?.value, 'annual detail order total reconciles with ranking');
  t.assertEqual(annualDetail.data?.data?.detail?.orders?.length, 1, 'annual detail contains the released order once');
  t.assertEqual(
    String(annualDetail.data?.data?.detail?.orders?.[0]?.releaseDate || '').slice(0, 10),
    dateInput(releaseDate),
    'annual evidence reports release date rather than ship date',
  );

  const capacityDetail = await t.request(
    'GET',
    detailUrl('payment-capacity', customerAId, undefined, capacityUser.data?.data?.asOf),
    { expectedStatus: 200 },
  );
  t.assertEqual(capacityDetail.data?.data?.value, capacityUserRow?.value, 'capacity detail average reconciles with ranking');
  t.assertEqual(capacityDetail.data?.data?.detail?.total, receiptAmount, 'capacity detail total equals included receipts');
  const capacityReceipts = (capacityDetail.data?.data?.detail?.months || [])
    .flatMap((month) => Array.isArray(month.receipts) ? month.receipts : []);
  t.assertEqual(capacityReceipts.length, 1, 'the same receipt appears once across all capacity months');
  t.assertEqual(capacityReceipts[0]?.receiptId, receiptId, 'capacity evidence keeps the source receipt identity');
  t.assertEqual(capacityReceipts[0]?.isDeposit, true, 'deposit receipts count in payment capacity');

  const cycleDetail = await t.request(
    'GET',
    detailUrl('payment-cycle', customerAId, undefined, cycleUser.data?.data?.asOf),
    { expectedStatus: 200 },
  );
  t.assertEqual(cycleDetail.data?.data?.value, cycleUserRow?.value, 'cycle detail value reconciles with ranking');
  t.assertEqual(cycleDetail.data?.data?.detail?.eligibleOrderCount, 1, 'cycle detail contains the eligible released order');
  t.assertEqual(cycleDetail.data?.data?.detail?.paidAmount, receiptAmount, 'cycle detail allocates the receipt once');
  t.assertEqual(cycleDetail.data?.data?.detail?.orders?.[0]?.outstanding, 88000, 'cycle detail exposes the remaining order balance');

  await t.request(
    'GET',
    detailUrl('payment-cycle', customerAId, undefined, '2026-02-30T12:00:00.000Z'),
    { expectedStatus: 400 },
  );
  t.step('detail rejects a non-canonical normalized asOf timestamp');

  await t.request('GET', detailUrl('annual-amount', customerBId, nowParts.year), { expectedStatus: 404 });
  t.step('USER A cannot open analytics detail for the sibling branch customer');

  await t.request('POST', '/api/settings', {
    json: {
      action: 'update-config',
      settings: { CUSTOMER_ANALYTICS_NORMAL_DAYS: '31' },
    },
    expectedStatus: 403,
  });
  t.step('non-admin cannot update global customer analytics settings');

  await t.logout();
  await t.loginAdmin();

  for (const metric of ['annual-amount', 'payment-capacity', 'payment-cycle']) {
    const ranking = await t.request('GET', metricUrl(metric, nowParts.year), { expectedStatus: 200 });
    t.assertEqual(Boolean(findCustomerRow(ranking, customerAId)), true, `ADMIN ${metric} ranking includes branch A`);
    t.assertEqual(Boolean(findCustomerRow(ranking, customerBId)), true, `ADMIN ${metric} ranking includes branch B`);
    if (metric === 'payment-capacity') {
      t.assertEqual(findCustomerRow(ranking, customerBId)?.value, 0, 'zero-payment visible customer remains in capacity ranking');
    }
  }

  const settingsBefore = await t.request('GET', '/api/settings', { expectedStatus: 200 });
  const currentSettings = settingsBefore.data?.data?.settings || {};
  const originalAnalyticsSettings = Object.fromEntries(
    analyticsSettingKeys.map((key) => [key, String(currentSettings[key] || '')]),
  );
  const validAnalyticsSettings = {
    CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12',
    CUSTOMER_ANALYTICS_NORMAL_DAYS: '31',
    CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '61',
    CUSTOMER_ANALYTICS_DELAY_DAYS: '91',
    CUSTOMER_ANALYTICS_WARNING_DAYS: '121',
    CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '151',
    CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '181',
  };

  await t.request('POST', '/api/settings', {
    json: { action: 'update-config', settings: validAnalyticsSettings },
    expectedStatus: 200,
  });
  const settingsAfterValid = await t.request('GET', '/api/settings', { expectedStatus: 200 });
  t.assertEqual(
    settingsAfterValid.data?.data?.settings?.CUSTOMER_ANALYTICS_NORMAL_DAYS,
    '31',
    'ADMIN can persist valid analytics thresholds',
  );

  await t.request('POST', '/api/settings', {
    json: {
      action: 'update-config',
      settings: {
        ...validAnalyticsSettings,
        CUSTOMER_ANALYTICS_NORMAL_DAYS: '62',
        CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '32',
      },
    },
    expectedStatus: 400,
  });
  const settingsAfterInvalid = await t.request('GET', '/api/settings', { expectedStatus: 200 });
  t.assertEqual(
    settingsAfterInvalid.data?.data?.settings?.CUSTOMER_ANALYTICS_NORMAL_DAYS,
    '31',
    'reversed threshold rejection leaves the previous normal-days value unchanged',
  );
  t.assertEqual(
    settingsAfterInvalid.data?.data?.settings?.CUSTOMER_ANALYTICS_MILD_DELAY_DAYS,
    '61',
    'reversed threshold rejection does not partially persist another field',
  );

  await t.request('POST', '/api/settings', {
    json: { action: 'update-config', settings: originalAnalyticsSettings },
    expectedStatus: 200,
  });
  t.step('global analytics settings restored after isolated assertions');

  await t.logout();
}
