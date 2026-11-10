import { PrismaClient } from '@prisma/client';

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
  t.assertEqual(trackerRow?.confirmedAt, null, 'new In progress order has no confirmed date');

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
  t.assertOk(Number.isFinite(Date.parse(String(updatedRow?.confirmedAt || ''))), 'entering Confirmed records a timestamp');
  const firstConfirmedAt = String(updatedRow.confirmedAt);

  await t.request('POST', '/api/orders', {
    json: {
      action: 'update',
      orderId: trackerRow.id,
      remark: 'Remark changed after confirmation',
    },
    expectedStatus: 200,
  });
  const remarkOnlyList = await t.request('GET', `/api/orders?search=${encodeURIComponent(trackerOrderNo)}`, {
    expectedStatus: 200,
  });
  t.assertEqual(
    findOrder(remarkOnlyList.data?.data, trackerOrderNo)?.confirmedAt,
    firstConfirmedAt,
    'remark-only update preserves confirmed date',
  );

  await t.request('POST', '/api/orders', {
    json: {
      action: 'update',
      orderId: trackerRow.id,
      status: 'Canceled',
    },
    expectedStatus: 200,
  });
  const canceledList = await t.request('GET', `/api/orders?search=${encodeURIComponent(trackerOrderNo)}`, {
    expectedStatus: 200,
  });
  t.assertEqual(findOrder(canceledList.data?.data, trackerOrderNo)?.confirmedAt, null, 'leaving Confirmed clears the date');

  await new Promise((resolve) => setTimeout(resolve, 20));
  await t.request('POST', '/api/orders', {
    json: {
      action: 'update',
      orderId: trackerRow.id,
      status: 'Confirmed',
    },
    expectedStatus: 200,
  });
  const reconfirmedList = await t.request('GET', `/api/orders?search=${encodeURIComponent(trackerOrderNo)}`, {
    expectedStatus: 200,
  });
  const reconfirmedAt = String(findOrder(reconfirmedList.data?.data, trackerOrderNo)?.confirmedAt || '');
  t.assertOk(Number.isFinite(Date.parse(reconfirmedAt)), 'returning to Confirmed records a timestamp');
  t.assertOk(Date.parse(reconfirmedAt) > Date.parse(firstConfirmedAt), 'returning to Confirmed records a newer timestamp');

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

  const password = 'OrdersTest@2026!';
  const childAdmin = await t.createUser({ email: `${suffix}-admin@example.com`, password, role: 'ADMIN', name: 'Orders child admin' });
  const sales = await t.createUser({ email: `${suffix}-sales@example.com`, password, role: 'SALES', name: 'Orders sales', parentId: childAdmin.data.data.id });
  await t.createUser({ email: `${suffix}-user@example.com`, password, role: 'USER', name: 'Orders user', parentId: sales.data.data.id });
  for (const role of ['sales', 'user']) {
    await t.logout();
    await t.login(`${suffix}-${role}@example.com`, password);
    const ownTracker = await t.request('POST', '/api/orders', {
      json: { action: 'create', orderNo: `${mark}-${role}`, customerId }, expectedStatus: 200,
    });
    const ownList = await t.request('GET', `/api/orders?search=${mark}-${role}`, { expectedStatus: 200 });
    const ownRow = findOrder(ownList.data.data, `${mark}-${role}`);
    t.assertEqual(ownRow.canDelete, false, `${role} has no delete capability`);
    t.assertEqual(ownRow.canEditAdminFields, false, `${role} has no inline PI capability`);
    await t.request('POST', '/api/orders', {
      json: { action: 'delete', orderId: ownTracker.data.data.id }, expectedStatus: 403,
    });
    await t.request('POST', '/api/orders', {
      json: { action: 'update', orderId: ownTracker.data.data.id, piStatus: true }, expectedStatus: 403,
    });
  }
  await t.logout();
  await t.login(`${suffix}-admin@example.com`, password);
  await t.request('POST', '/api/orders', {
    json: { action: 'delete', orderId: trackerRow.id }, expectedStatus: 404,
  });
  t.step('backend enforces role and management-tree deletion boundaries');
  await t.logout();
  await t.loginAdmin();

  const prisma = new PrismaClient();
  try {
    const beforeFinance = await prisma.order.findMany({ orderBy: { id: 'asc' } });
    const beforeReceipts = await prisma.receipt.findMany({ orderBy: { id: 'asc' } });
    const adminList = await t.request('GET', `/api/orders?search=${trackerOrderNo}`, { expectedStatus: 200 });
    t.assertEqual(findOrder(adminList.data.data, trackerOrderNo).canDelete, true, 'ADMIN receives delete capability');
    await t.request('POST', '/api/orders', {
      json: { action: 'update', orderId: trackerRow.id, piStatus: false }, expectedStatus: 200,
    });
    const unchecked = await prisma.orderTracker.findUniqueOrThrow({ where: { id: trackerRow.id } });
    t.assertEqual(unchecked.piStatus, false, 'inline PI update persists false without changing other fields');
    t.assertEqual(unchecked.status, 'Confirmed', 'inline PI update preserves order status');
    await t.request('POST', '/api/orders', {
      json: { action: 'update', orderId: trackerRow.id, piStatus: 'false' }, expectedStatus: 400,
    });

    for (const id of [trackerRow.id, financeTrackerResponse.data.data.id]) {
      await t.request('POST', '/api/orders', { json: { action: 'delete', orderId: id }, expectedStatus: 200 });
      await t.request('POST', '/api/orders', { json: { action: 'delete', orderId: id }, expectedStatus: 200 });
      const archived = await prisma.orderTracker.findUniqueOrThrow({ where: { id } });
      t.assertOk(Boolean(archived.archivedAt), 'deleted tracker retained for recovery');
      t.assertEqual(archived.archiveReason, 'ADMIN_DELETED', 'admin deletion distinguishable from source rename');
      t.assertEqual(await prisma.auditLog.count({ where: { action: 'ORDER_TRACKER_DELETE', targetId: id } }), 1, 'deletion audit is idempotent');
      await t.request('POST', '/api/orders', { json: { action: 'update', orderId: id, piStatus: true }, expectedStatus: 404 });
    }
    const deletedList = await t.request('GET', `/api/orders?search=${trackerOrderNo}`, { expectedStatus: 200 });
    t.assertOk(!findOrder(deletedList.data.data, trackerOrderNo), 'deleted record no longer appears in Orders');
    t.assertEqual(JSON.stringify(await prisma.order.findMany({ orderBy: { id: 'asc' } })), JSON.stringify(beforeFinance), 'finance rows unchanged');
    t.assertEqual(JSON.stringify(await prisma.receipt.findMany({ orderBy: { id: 'asc' } })), JSON.stringify(beforeReceipts), 'receipt rows unchanged');
    await t.request('POST', '/api/orders', {
      json: { action: 'create', orderNo: trackerOrderNo, customerId }, expectedStatus: 200,
    });
    t.step('archive, audit, repeat deletion, PI update, financial isolation and order-number reuse verified');
  } finally {
    await prisma.$disconnect();
  }

  await t.logout();
}
