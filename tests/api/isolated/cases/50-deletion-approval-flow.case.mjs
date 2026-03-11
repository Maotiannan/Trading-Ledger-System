export const name = 'deletion-approval-flow';

function findReceiptByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.orderNo === orderNo);
}

function findDetailByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => Array.isArray(row.items) && row.items.some((item) => item.orderNo === orderNo));
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('delete');
  const salesEmail = `${suffix}-sales@example.com`;
  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sales ${suffix}`,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'deletion test sales account created');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  const receiptOrderNo = `DEL-${suffix}-RCPT-01`;
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}`,
      usd: 120,
      orderNo: receiptOrderNo,
      customerMark: `DEL-${suffix}`,
      customerName: `DEL-${suffix}`,
    },
    expectedStatus: 200,
  });
  t.step('sales can direct-create receipt for deletion flow');

  const receiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(receiptOrderNo)}`, { expectedStatus: 200 });
  const createdReceipt = findReceiptByOrder(receiptList.data?.data, receiptOrderNo);
  t.assertOk(Boolean(createdReceipt?.id), 'created receipt is queryable before deletion');

  const receiptDeletionRequest = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'RECEIPT',
      targetId: createdReceipt.id,
    },
    expectedStatus: 200,
  });
  const receiptRequestId = String(receiptDeletionRequest.data?.data?.id || '');
  t.assertOk(Boolean(receiptRequestId), 'receipt deletion request created');

  const salesApproveDenied = await t.request('POST', '/api/deletion', {
    json: {
      action: 'approve',
      requestId: receiptRequestId,
    },
    expectedStatus: 403,
  });
  t.assertMatch(salesApproveDenied.data?.error || salesApproveDenied.text, /管理员/, 'sales cannot approve deletion requests');

  const detailOrderNo = `DEL-${suffix}-DETAIL-01`;
  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ mark: `DEL-${suffix}`, orderNo: detailOrderNo, amount: 240 }],
    },
    expectedStatus: 200,
  });
  t.step('sales can direct-create detail for cascade deletion flow');

  const detailList = await t.request('GET', `/api/detail?search=${encodeURIComponent(detailOrderNo)}`, { expectedStatus: 200 });
  const createdDetail = findDetailByOrder(detailList.data?.data, detailOrderNo);
  t.assertOk(Boolean(createdDetail?.id), 'created detail is queryable before deletion');
  const autoReceiptId = createdDetail.items?.[0]?.receiptId || null;
  t.assertOk(Boolean(autoReceiptId), 'detail direct-create generated linked auto receipt');

  const detailDeletionRequest = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'DETAIL',
      targetId: createdDetail.id,
    },
    expectedStatus: 200,
  });
  const detailRequestId = String(detailDeletionRequest.data?.data?.id || '');
  t.assertOk(Boolean(detailRequestId), 'detail deletion request created');

  const swiftOrderNo = `DEL-${suffix}-SWIFT-01`;
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-SW-${suffix}`,
      usd: 330,
      orderNo: swiftOrderNo,
      customerMark: `DEL-${suffix}`,
      customerName: `DEL-${suffix}`,
    },
    expectedStatus: 200,
  });
  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ mark: `DEL-${suffix}`, orderNo: swiftOrderNo, amount: 330 }],
    },
    expectedStatus: 200,
  });
  t.step('sales can create receipt-detail pair for swift deletion flow');

  const swiftDetailList = await t.request('GET', `/api/detail?search=${encodeURIComponent(swiftOrderNo)}`, { expectedStatus: 200 });
  const swiftDetail = findDetailByOrder(swiftDetailList.data?.data, swiftOrderNo);
  t.assertOk(Boolean(swiftDetail?.id), 'swift detail exists before swift creation');
  const swiftReceiptId = swiftDetail.items?.[0]?.receiptId || null;
  t.assertOk(Boolean(swiftReceiptId), 'swift flow detail linked to receipt');

  await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: swiftDetail.id,
      amount: 330,
      senderName: 'Sender A',
      receiverName: 'Receiver B',
    },
    expectedStatus: 200,
  });
  t.step('sales can direct-create swift for deletion flow');

  const swiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(swiftOrderNo)}`, { expectedStatus: 200 });
  const createdSwift = Array.isArray(swiftList.data?.data) ? swiftList.data.data.find((row) => row.detailId === swiftDetail.id) : null;
  t.assertOk(Boolean(createdSwift?.id), 'created swift is queryable before deletion');

  const swiftDeletionRequest = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'SWIFT',
      targetId: createdSwift.id,
    },
    expectedStatus: 200,
  });
  const swiftRequestId = String(swiftDeletionRequest.data?.data?.id || '');
  t.assertOk(Boolean(swiftRequestId), 'swift deletion request created');

  const salesRequestList = await t.request('GET', '/api/deletion', { expectedStatus: 200 });
  const salesRequestRows = Array.isArray(salesRequestList.data?.data) ? salesRequestList.data.data : [];
  t.assertOk(salesRequestRows.some((row) => row.id === swiftRequestId), 'sales can view submitted deletion requests');

  await t.logout();
  await t.loginAdmin();

  const adminRequestList = await t.request('GET', '/api/deletion', { expectedStatus: 200 });
  const adminRequestRows = Array.isArray(adminRequestList.data?.data) ? adminRequestList.data.data : [];
  t.assertOk(adminRequestRows.some((row) => row.id === receiptRequestId), 'admin can view receipt deletion request');
  t.assertOk(adminRequestRows.some((row) => row.id === detailRequestId), 'admin can view detail deletion request');
  t.assertOk(adminRequestRows.some((row) => row.id === swiftRequestId), 'admin can view swift deletion request');

  await t.request('POST', '/api/deletion', {
    json: { action: 'approve', requestId: receiptRequestId },
    expectedStatus: 200,
  });
  t.step('admin can approve receipt deletion request');

  const receiptAfterDelete = await t.request('GET', `/api/receipt?search=${encodeURIComponent(receiptOrderNo)}`, { expectedStatus: 200 });
  const remainingReceipt = findReceiptByOrder(receiptAfterDelete.data?.data, receiptOrderNo);
  t.assertOk(!remainingReceipt, 'approved receipt deletion removes receipt');

  await t.request('POST', '/api/deletion', {
    json: { action: 'approve', requestId: detailRequestId },
    expectedStatus: 200,
  });
  t.step('admin can approve detail deletion request');

  const detailAfterDelete = await t.request('GET', `/api/detail?search=${encodeURIComponent(detailOrderNo)}`, { expectedStatus: 200 });
  const remainingDetail = findDetailByOrder(detailAfterDelete.data?.data, detailOrderNo);
  t.assertOk(!remainingDetail, 'approved detail deletion removes detail');

  const autoReceiptAfterDelete = await t.request('GET', `/api/receipt?search=${encodeURIComponent(detailOrderNo)}`, { expectedStatus: 200 });
  const remainingAutoReceipt = findReceiptByOrder(autoReceiptAfterDelete.data?.data, detailOrderNo);
  t.assertOk(!remainingAutoReceipt, 'approved detail deletion removes auto-created receipt');

  const invoiceAfterDetailDelete = await t.request('GET', `/api/invoice?search=${encodeURIComponent(detailOrderNo)}`, { expectedStatus: 200 });
  const invoiceRows = Array.isArray(invoiceAfterDetailDelete.data?.data) ? invoiceAfterDetailDelete.data.data : [];
  const hasRemainingOrder = invoiceRows.some((invoice) =>
    Array.isArray(invoice.orders) && invoice.orders.some((order) => order.orderNo === detailOrderNo)
  );
  t.assertOk(!hasRemainingOrder, 'approved detail deletion removes auto-created empty order');

  await t.request('POST', '/api/deletion', {
    json: { action: 'approve', requestId: swiftRequestId },
    expectedStatus: 200,
  });
  t.step('admin can approve swift deletion request');

  const swiftAfterDelete = await t.request('GET', `/api/swift?search=${encodeURIComponent(swiftOrderNo)}`, { expectedStatus: 200 });
  const remainingSwift = Array.isArray(swiftAfterDelete.data?.data) ? swiftAfterDelete.data.data.find((row) => row.detailId === swiftDetail.id) : null;
  t.assertOk(!remainingSwift, 'approved swift deletion removes swift');

  const detailAfterSwiftDelete = await t.request('GET', `/api/detail?search=${encodeURIComponent(swiftOrderNo)}`, { expectedStatus: 200 });
  const rollbackDetail = findDetailByOrder(detailAfterSwiftDelete.data?.data, swiftOrderNo);
  t.assertEqual(rollbackDetail?.status, 'Waiting_SWIFT', 'approved swift deletion rolls detail back to Waiting_SWIFT');

  const receiptAfterSwiftDelete = await t.request('GET', `/api/receipt?search=${encodeURIComponent(swiftOrderNo)}`, { expectedStatus: 200 });
  const rollbackReceipt = findReceiptByOrder(receiptAfterSwiftDelete.data?.data, swiftOrderNo);
  t.assertEqual(rollbackReceipt?.status, 'Waiting_SWIFT', 'approved swift deletion rolls receipt back to Waiting_SWIFT');

  await t.logout();
}
