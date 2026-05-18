export const name = 'order-tracker';

function findOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.orderNo === orderNo);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('orders');
  const mark = `OT-${suffix}`;
  const trackerOrderNo = `${mark}-TRACK-01`;
  const financeOrderNo = `${mark}-FIN-01`;
  const invoiceNo = `INV-${suffix}`;

  const customer = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Order Tracker Customer ${suffix}`,
      phone: `624${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
    },
    expectedStatus: 200,
  });
  const customerId = String(customer.data?.data?.id || '');
  t.assertOk(Boolean(customerId), 'order tracker customer created');

  const customerOptions = await t.request('GET', `/api/orders?action=customer-options&search=${encodeURIComponent(mark)}`, {
    expectedStatus: 200,
  });
  const options = Array.isArray(customerOptions.data?.data) ? customerOptions.data.data : [];
  t.assertOk(options.some((row) => row.id === customerId), 'orders customer options include visible customer');

  const createdTracker = await t.request('POST', '/api/orders', {
    json: {
      action: 'create',
      orderNo: trackerOrderNo,
      customerId,
      remark: 'Prepare PI',
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(createdTracker.data?.data?.id), 'orders page record created');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}`,
      usd: 777,
      orderNo: trackerOrderNo,
      customerMark: mark,
      customerName: mark,
      isDeposit: true,
    },
    expectedStatus: 200,
  });
  t.step('deposit receipt created for orders page record');

  const trackerList = await t.request('GET', `/api/orders?search=${encodeURIComponent(trackerOrderNo)}`, {
    expectedStatus: 200,
  });
  const trackerRow = findOrder(trackerList.data?.data, trackerOrderNo);
  t.assertOk(Boolean(trackerRow?.id), 'orders page list returns created record');
  t.assertEqual(Number(trackerRow?.depositAmount), 777, 'orders page deposit amount is auto-summed');

  await t.request('POST', '/api/orders', {
    json: {
      action: 'update',
      orderId: trackerRow.id,
      status: 'Confirmed',
      remark: 'PI confirmed',
      piStatus: true,
      systemNote: 'Admin checked',
    },
    expectedStatus: 200,
  });
  t.step('admin can update status, remark, PI status and system note');

  const updatedList = await t.request('GET', `/api/orders?search=${encodeURIComponent(trackerOrderNo)}`, {
    expectedStatus: 200,
  });
  const updatedRow = findOrder(updatedList.data?.data, trackerOrderNo);
  t.assertEqual(updatedRow?.status, 'Confirmed', 'orders page status persisted');
  t.assertEqual(updatedRow?.piStatus, true, 'orders page PI status persisted');
  t.assertEqual(updatedRow?.systemNote, 'Admin checked', 'orders page system note persisted');

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNo,
      orders: [
        { orderNo: financeOrderNo, amount: 100, customerMark: mark, customerName: mark },
      ],
    },
    expectedStatus: 200,
  });
  t.step('finance order created for duplicate guard');

  const financeTrackerResponse = await t.request('POST', '/api/orders', {
    json: {
      action: 'create',
      orderNo: financeOrderNo,
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(financeTrackerResponse.data?.data?.id), 'orders page allows finance order numbers as independent tracking rows');
  t.assertEqual(financeTrackerResponse.data?.data?.customerId, customerId, 'orders page infers customer from finance order when customer is omitted');
  t.assertOk(Boolean(financeTrackerResponse.data?.data?.financeOrderId), 'orders page links the visible finance order when creating from finance order number');

  await t.logout();
}
