export const name = 'swift-multiple-copies-and-fees';

function findReceiptByOrder(rows, orderNo) { return rows.find((row) => row.orderNo === orderNo); }
function findDetailByOrder(rows, orderNo) { return rows.find((row) => row.items.some((item) => item.orderNo === orderNo)); }

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

async function getDetail(t, id) {
  const response = await t.request('GET', '/api/detail', { expectedStatus: 200 });
  return response.data.data.find((row) => row.id === id);
}
async function createSwift(t, id, amount, extra = {}, expectedStatus = 200) {
  return t.request('POST', '/api/swift', {
    json: { action: 'direct-create', detailId: id, amount, date: '2026-10-21', senderName: 'Partial transfer', ...extra }, ...(expectedStatus ? { expectedStatus } : {}),
  });
}
async function receive(t, swiftId) {
  return t.request('POST', '/api/swift', { json: { action: 'mark-received', swiftId }, expectedStatus: 200 });
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();
  const suffix = t.unique('multiple-swift');
  const pair = await createPair(t, suffix, 'MITTY', 75093);
  const receiptDeletion = await t.request('POST', '/api/deletion', {
    json: { action: 'request', targetType: 'RECEIPT', targetId: pair.receiptId }, expectedStatus: 200,
  });
  const first = await createSwift(t, pair.detailId, 50000);
  const firstId = first.data.data.swift.id;
  await receive(t, firstId);
  let detail = await getDetail(t, pair.detailId);
  t.assertEqual(detail.status, 'Bank_Transfer', 'one received partial SWIFT cannot complete the payment detail');
  t.assertEqual(detail.transferSummary.remainingAmount, 25093, 'actual outstanding transfer balance');
  await t.request('POST', '/api/deletion', {
    json: { action: 'approve', requestId: receiptDeletion.data.data.id }, expectedStatus: 400,
  });
  detail = await getDetail(t, pair.detailId);
  t.assertEqual(Number(detail.totalAmount), 75093, 'unsafe receipt deletion rolls back the payment total');
  t.assertOk(detail.items.some((item) => item.receiptId === pair.receiptId), 'unsafe deletion retains the original receipt link');
  await t.request('POST', '/api/deletion', {
    json: { action: 'reject', requestId: receiptDeletion.data.data.id }, expectedStatus: 200,
  });
  let options = await t.request('GET', '/api/detail?action=waiting-options', { expectedStatus: 200 });
  t.assertOk(options.data.data.some((row) => row.id === pair.detailId), 'partial details remain available after first copy received');
  await createSwift(t, pair.detailId, 25093.01, {}, 400);

  const second = await createSwift(t, pair.detailId, 25093, { date: '2026-10-22' });
  const secondId = second.data.data.swift.id;
  detail = await getDetail(t, pair.detailId);
  t.assertEqual(detail.status, 'Bank_Transfer', 'full total awaits second SWIFT signoff');
  t.assertEqual(detail.transferSummary.transferredAmount, 75093, 'two copies are added together');
  t.assertEqual(detail.transferSummary.remainingAmount, 0, 'actual zero balance');
  const list = await t.request('GET', `/api/swift?search=${encodeURIComponent(pair.orderNo)}`, { expectedStatus: 200 });
  const linked = list.data.data.filter((row) => row.detailId === pair.detailId);
  t.assertEqual(linked.length, 2, 'both independently persisted copies remain linked');
  t.assertEqual(linked.find((row) => row.id === firstId).status, 'RECEIVED', 'new upload preserves previous received status');
  t.assertEqual(linked.find((row) => row.id === secondId).date.slice(0, 10), '2026-10-22', 'each copy keeps its own date');
  await t.request('POST', '/api/receipt', { json: { action: 'mark-received', receiptId: pair.receiptId }, expectedStatus: 400 });
  t.assertEqual((await getDetail(t, pair.detailId)).status, 'Bank_Transfer', 'direct receipt action cannot prematurely complete unpaid SWIFT copies');
  await receive(t, secondId);
  t.assertEqual((await getDetail(t, pair.detailId)).status, 'RECEIVED', 'last signature completes payment');
  await createSwift(t, pair.detailId, 1, {}, 400);

  const request = await t.request('POST', '/api/deletion', { json: { action: 'request', targetType: 'SWIFT', targetId: secondId }, expectedStatus: 200 });
  await t.request('POST', '/api/deletion', { json: { action: 'approve', requestId: request.data.data.id }, expectedStatus: 200 });
  detail = await getDetail(t, pair.detailId);
  t.assertEqual(detail.status, 'Bank_Transfer', 'deleting one of several copies recalculates remaining payment');
  t.assertEqual(detail.transferSummary.transferredAmount, 50000, 'received first copy is retained after approved deletion');
  t.assertEqual(detail.transferSummary.remainingAmount, 25093, 'deletion restores actual remaining balance');

  const eight = await createPair(t, suffix, 'EIGHT', 80000);
  for (let index = 0; index < 8; index++) {
    const swift = await createSwift(t, eight.detailId, 9980);
    await receive(t, swift.data.data.swift.id);
    detail = await getDetail(t, eight.detailId);
    t.assertEqual(detail.status, index === 7 ? 'RECEIVED' : 'Bank_Transfer', `copy ${index + 1} signed independently`);
  }
  t.assertEqual(detail.transferSummary.remainingAmount, 160, 'accepted fees remain visible as actual unpaid amount');
  t.assertEqual(detail.transferSummary.transferredAmount, 79840, 'eight transfer total is accurate');
  await createSwift(t, eight.detailId, 160, {}, 400);

  for (const [label, amount, status] of [['BOUNDARY', 960, 'RECEIVED'], ['OUTSIDE', 959.99, 'Bank_Transfer']]) {
    const boundary = await createPair(t, suffix, label, 1000);
    const swift = await createSwift(t, boundary.detailId, amount);
    await receive(t, swift.data.data.swift.id);
    t.assertEqual((await getDetail(t, boundary.detailId)).status, status, `40 dollar fee boundary: ${label}`);
  }
  const concurrent = await createPair(t, suffix, 'CONCURRENT', 80000);
  const results = await Promise.all([createSwift(t, concurrent.detailId, 50000, {}, 0), createSwift(t, concurrent.detailId, 50000, {}, 0)]);
  t.assertEqual(results.filter((row) => row.status === 200).length, 1, 'parent lock prevents simultaneous aggregate overpayment');
  t.assertEqual(results.filter((row) => row.status === 400).length, 1, 'concurrent excess is rejected');
  t.step('multiple SWIFT copies, independent signatures, fees, deletion, actual balance and concurrency');
  await t.logout();
}
