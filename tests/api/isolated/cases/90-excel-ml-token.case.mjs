export const name = 'excel-ml-token';

export default async function run(t) {
  await t.initAdmin();
  const login = await t.loginAdmin();
  const adminId = String(login.data?.data?.id || '');
  t.assertOk(Boolean(adminId), 'admin id available for Excel ML token case');

  const suffix = t.unique('excel');
  const orderName = `GANDO${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`;
  const orderNo = `${orderName}-10`;
  const customerName = `Gando Customer ${suffix}`;
  const mark = `MK-${suffix}`;
  const phone = `622${Math.floor(Math.random() * 900000 + 100000)}`;

  const tokenCreate = await t.request('POST', '/api/excel/token', {
    json: { action: 'generate', name: 'Excel isolated test' },
    expectedStatus: 200,
  });
  const token = String(tokenCreate.data?.data?.token || '');
  const tokenId = String(tokenCreate.data?.data?.tokenInfo?.id || '');
  t.assertMatch(token, /^ml_/, 'Excel token is generated once');
  t.assertOk(Boolean(tokenId), 'Excel token id returned');

  const tokenList = await t.request('GET', '/api/excel/token', { expectedStatus: 200 });
  const tokenRows = Array.isArray(tokenList.data?.data) ? tokenList.data.data : [];
  t.assertOk(tokenRows.some((row) => row.id === tokenId), 'Excel token list includes generated token metadata');

  const customer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark,
      orderName,
      name: customerName,
      phone,
      city: 'Conakry',
      companyName: '',
      ownerId: adminId,
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(customer.data?.data?.id), 'Excel ML customer created');

  const field1 = await t.request('GET', `/api/excel/ml?orderNo=${encodeURIComponent(orderNo)}&field=1`, {
    headers: { Authorization: `Bearer ${token}` },
    expectedStatus: 200,
  });
  t.assertEqual(field1.text, orderName, 'Excel ML field 1 returns ORDER NAME');

  const field2 = await t.request('GET', `/api/excel/ml?orderNo=${encodeURIComponent(orderNo)}&field=2`, {
    headers: { Authorization: `Bearer ${token}` },
    expectedStatus: 200,
  });
  t.assertEqual(field2.text, customerName, 'Excel ML field 2 falls back to Customer.name when company is empty');

  const field3 = await t.request('GET', `/api/excel/ml?orderNo=${encodeURIComponent(orderNo)}&field=3`, {
    headers: { Authorization: `Bearer ${token}` },
    expectedStatus: 200,
  });
  t.assertEqual(field3.text, mark, 'Excel ML field 3 returns MARK');

  const jsonLookup = await t.request('GET', `/api/excel/ml?orderNo=${encodeURIComponent(orderNo)}&field=2&format=json`, {
    headers: { Authorization: `Bearer ${token}` },
    expectedStatus: 200,
  });
  t.assertEqual(jsonLookup.data?.data?.fieldKey, 'DISPLAY_NAME', 'Excel ML JSON diagnostics include field key');
  t.assertEqual(jsonLookup.data?.data?.matchedBy, 'derived-order-name', 'Excel ML JSON diagnostics include match mode');

  const batch = await t.request('POST', '/api/excel/ml/batch', {
    headers: { Authorization: `Bearer ${token}` },
    json: {
      items: [
        { orderNo, field: 1 },
        { orderNo, field: 2 },
        { orderNo: `MISSING-${suffix}`, field: 1 },
      ],
    },
    expectedStatus: 200,
  });
  const rows = Array.isArray(batch.data?.data) ? batch.data.data : [];
  t.assertEqual(rows.length, 3, 'Excel ML batch returns one row per input');
  t.assertEqual(rows[0]?.value, orderName, 'Excel ML batch field 1 value returned');
  t.assertEqual(rows[1]?.value, customerName, 'Excel ML batch field 2 value returned');
  t.assertEqual(rows[2]?.code, 'EXCEL_ORDER_NOT_FOUND', 'Excel ML batch captures row errors');

  await t.request('POST', '/api/excel/token', {
    json: { action: 'revoke', id: tokenId },
    expectedStatus: 200,
  });
  t.step('Excel token revoked');

  const revoked = await t.request('GET', `/api/excel/ml?orderNo=${encodeURIComponent(orderNo)}&field=1`, {
    headers: { Authorization: `Bearer ${token}` },
    expectedStatus: 401,
  });
  t.assertEqual(revoked.data?.code, 'EXCEL_TOKEN_REVOKED', 'revoked Excel token is rejected');
}
