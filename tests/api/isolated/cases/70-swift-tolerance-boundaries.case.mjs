export const name = 'swift-tolerance-boundaries';

function findReceiptByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.orderNo === orderNo);
}

function findDetailByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => Array.isArray(row.items) && row.items.some((item) => item.orderNo === orderNo));
}

function findSwiftByDetail(rows, detailId) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.detailId === detailId);
}

async function createPair(t, suffix, orderSuffix, amount) {
  const orderNo = `TOL-${suffix}-${orderSuffix}`;
  const customerMark = `TOL-${suffix}`;

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}-${orderSuffix}`,
      usd: amount,
      orderNo,
      customerMark,
      customerName: customerMark,
    },
    expectedStatus: 200,
  });

  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ mark: customerMark, orderNo, amount }],
    },
    expectedStatus: 200,
  });

  const detailList = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const detail = findDetailByOrder(detailList.data?.data, orderNo);
  t.assertOk(Boolean(detail?.id), `detail exists for tolerance case ${orderSuffix}`);

  const receiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receipt = findReceiptByOrder(receiptList.data?.data, orderNo);
  t.assertOk(Boolean(receipt?.id), `receipt exists for tolerance case ${orderSuffix}`);

  return { orderNo, detailId: detail.id, receiptId: receipt.id };
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('tolerance');
  const salesEmail = `${suffix}-sales@example.com`;
  await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Tolerance ${suffix}`,
  });
  t.step('tolerance sales account created');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  const exactBoundary = await createPair(t, suffix, '05', 100);
  const exactBoundarySwift = await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: exactBoundary.detailId,
      amount: 105,
      senderName: 'Tolerance Sender',
      receiverName: 'Tolerance Receiver',
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(exactBoundarySwift.data?.data?.validation?.valid), true, 'difference of 5 stays valid');
  t.assertEqual(Boolean(exactBoundarySwift.data?.data?.validation?.hasWarning), false, 'difference of 5 has no warning');

  const exactBoundarySwiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(exactBoundary.orderNo)}`, { expectedStatus: 200 });
  const exactBoundarySwiftRow = findSwiftByDetail(exactBoundarySwiftList.data?.data, exactBoundary.detailId);
  t.assertEqual(Boolean(exactBoundarySwiftRow?.hasError), false, 'difference of 5 does not mark swift as error');
  t.assertEqual(exactBoundarySwiftRow?.status, 'Bank_Transfer', 'difference of 5 keeps swift in Bank_Transfer');

  const warningBoundary = await createPair(t, suffix, '06', 100);
  const warningBoundarySwift = await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: warningBoundary.detailId,
      amount: 106,
      senderName: 'Tolerance Sender',
      receiverName: 'Tolerance Receiver',
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(warningBoundarySwift.data?.data?.validation?.valid), true, 'difference of 6 still validates');
  t.assertEqual(Boolean(warningBoundarySwift.data?.data?.validation?.hasWarning), true, 'difference of 6 raises warning');
  t.assertMatch(warningBoundarySwift.data?.data?.validation?.message || '', /超出正常容差/, 'difference of 6 returns warning message');

  const warningBoundarySwiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(warningBoundary.orderNo)}`, { expectedStatus: 200 });
  const warningSwiftRow = findSwiftByDetail(warningBoundarySwiftList.data?.data, warningBoundary.detailId);
  t.assertEqual(Boolean(warningSwiftRow?.hasError), true, 'difference of 6 marks swift as warning/error');
  t.assertEqual(warningSwiftRow?.status, 'Bank_Transfer', 'difference of 6 still keeps swift in Bank_Transfer');

  const warningReceipt = await t.request('GET', `/api/receipt?search=${encodeURIComponent(warningBoundary.orderNo)}`, { expectedStatus: 200 });
  t.assertEqual(findReceiptByOrder(warningReceipt.data?.data, warningBoundary.orderNo)?.status, 'Bank_Transfer', 'difference of 6 still advances receipt status');
  const warningDetail = await t.request('GET', `/api/detail?search=${encodeURIComponent(warningBoundary.orderNo)}`, { expectedStatus: 200 });
  t.assertEqual(findDetailByOrder(warningDetail.data?.data, warningBoundary.orderNo)?.status, 'Bank_Transfer', 'difference of 6 still advances detail status');

  const maxBoundary = await createPair(t, suffix, '50', 100);
  const maxBoundarySwift = await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: maxBoundary.detailId,
      amount: 150,
      senderName: 'Tolerance Sender',
      receiverName: 'Tolerance Receiver',
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(maxBoundarySwift.data?.data?.validation?.valid), true, 'difference of 50 still validates');
  t.assertEqual(Boolean(maxBoundarySwift.data?.data?.validation?.hasWarning), true, 'difference of 50 raises warning');

  const errorBoundary = await createPair(t, suffix, '51', 100);
  const errorBoundarySwift = await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: errorBoundary.detailId,
      amount: 151,
      senderName: 'Tolerance Sender',
      receiverName: 'Tolerance Receiver',
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(errorBoundarySwift.data?.data?.validation?.valid), false, 'difference of 51 is rejected');
  t.assertEqual(Boolean(errorBoundarySwift.data?.data?.validation?.hasWarning), true, 'difference of 51 still flags warning');
  t.assertMatch(errorBoundarySwift.data?.data?.validation?.message || '', /超过允许范围/, 'difference of 51 returns hard failure message');

  const errorSwiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(errorBoundary.orderNo)}`, { expectedStatus: 200 });
  const errorSwiftRow = findSwiftByDetail(errorSwiftList.data?.data, errorBoundary.detailId);
  t.assertOk(Boolean(errorSwiftRow?.id), 'error swift row is still persisted for review');
  t.assertEqual(Boolean(errorSwiftRow?.hasError), true, 'difference of 51 persists with hasError');
  t.assertEqual(errorSwiftRow?.status, 'ERROR', 'difference of 51 persists as ERROR');

  const errorReceipt = await t.request('GET', `/api/receipt?search=${encodeURIComponent(errorBoundary.orderNo)}`, { expectedStatus: 200 });
  t.assertEqual(findReceiptByOrder(errorReceipt.data?.data, errorBoundary.orderNo)?.status, 'Waiting_SWIFT', 'difference of 51 keeps receipt waiting');
  const errorDetail = await t.request('GET', `/api/detail?search=${encodeURIComponent(errorBoundary.orderNo)}`, { expectedStatus: 200 });
  t.assertEqual(findDetailByOrder(errorDetail.data?.data, errorBoundary.orderNo)?.status, 'Waiting_SWIFT', 'difference of 51 keeps detail waiting');

  await t.request('POST', '/api/swift', {
    json: {
      action: 'delete',
      swiftId: errorSwiftRow.id,
    },
    expectedStatus: 200,
  });
  t.step('creator can directly delete hard-error swift');

  const errorSwiftAfterDelete = await t.request('GET', `/api/swift?search=${encodeURIComponent(errorBoundary.orderNo)}`, { expectedStatus: 200 });
  const deletedErrorSwift = findSwiftByDetail(errorSwiftAfterDelete.data?.data, errorBoundary.detailId);
  t.assertOk(!deletedErrorSwift, 'hard-error swift is removed after direct delete');

  await t.logout();
}
