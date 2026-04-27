import { writeFileSync } from 'node:fs';

export const name = 'receipt-detail-swift-lifecycle';

function findReceiptByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.orderNo === orderNo);
}

function findDetailByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => Array.isArray(row.items) && row.items.some((item) => item.orderNo === orderNo));
}

function findSwiftByDetail(rows, detailId) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.detailId === detailId);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('lifecycle');
  const salesEmail = `${suffix}-sales@example.com`;
  await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Lifecycle ${suffix}`,
  });
  t.step('lifecycle sales account created');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  const orderNo = `LIFE-${suffix}-01`;
  const customerMark = `LIFE-${suffix}`;
  const directReceiptImagePath = `${t.tmpDir}/receipt-direct-${suffix}.png`;
  writeFileSync(
    directReceiptImagePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnKXuQAAAAASUVORK5CYII=', 'base64'),
  );

  const directReceiptImage = await t.request('POST', '/api/upload-image', {
    form: {
      action: 'upload',
      category: 'receipt-direct',
      file: {
        filePath: directReceiptImagePath,
        filename: `receipt-direct-${suffix}.png`,
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
  t.step('receipt direct-create image uploaded');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}`,
      usd: 220,
      orderNo,
      customerMark,
      customerName: customerMark,
      imagePath: directReceiptImage.data?.data?.path,
      imageName: directReceiptImage.data?.data?.name,
    },
    expectedStatus: 200,
  });
  t.step('lifecycle receipt created');

  const directReceiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const directReceipt = findReceiptByOrder(directReceiptList.data?.data, orderNo);
  t.assertMatch(directReceipt?.imageUrl || '', /\/upload\/images\/receipts\/direct\//, 'direct-create receipt keeps uploaded image path');
  t.assertMatch(directReceipt?.imageName || '', /receipt-direct-/, 'direct-create receipt keeps uploaded image name');

  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ mark: customerMark, orderNo, amount: 220 }],
    },
    expectedStatus: 200,
  });
  t.step('lifecycle detail created');

  const receiptBeforeSwift = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const linkedReceipt = findReceiptByOrder(receiptBeforeSwift.data?.data, orderNo);
  t.assertOk(Boolean(linkedReceipt?.id), 'linked receipt found before swift');
  t.assertEqual(linkedReceipt?.status, 'Waiting_SWIFT', 'linked receipt enters Waiting_SWIFT after detail creation');

  const detailBeforeSwift = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const linkedDetail = findDetailByOrder(detailBeforeSwift.data?.data, orderNo);
  t.assertOk(Boolean(linkedDetail?.id), 'linked detail found before swift');
  t.assertEqual(linkedDetail?.status, 'Waiting_SWIFT', 'linked detail starts in Waiting_SWIFT');

  const swiftCreate = await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: linkedDetail.id,
      amount: 220,
      senderName: 'Lifecycle Sender',
      receiverName: 'Lifecycle Receiver',
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(swiftCreate.data?.data?.validation?.valid), true, 'swift validation passes for exact amount');
  t.assertEqual(Boolean(swiftCreate.data?.data?.validation?.hasWarning), false, 'swift validation has no warning for exact amount');

  const swiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const createdSwift = findSwiftByDetail(swiftList.data?.data, linkedDetail.id);
  t.assertOk(Boolean(createdSwift?.id), 'swift record exists after creation');
  t.assertEqual(createdSwift?.status, 'Bank_Transfer', 'swift enters Bank_Transfer after exact match');

  const receiptAfterSwift = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const bankReceipt = findReceiptByOrder(receiptAfterSwift.data?.data, orderNo);
  t.assertEqual(bankReceipt?.status, 'Bank_Transfer', 'receipt enters Bank_Transfer after swift');

  const detailAfterSwift = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const bankDetail = findDetailByOrder(detailAfterSwift.data?.data, orderNo);
  t.assertEqual(bankDetail?.status, 'Bank_Transfer', 'detail enters Bank_Transfer after swift');

  const swiftDeletionRequest = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'SWIFT',
      targetId: createdSwift.id,
    },
    expectedStatus: 200,
  });
  const requestId = String(swiftDeletionRequest.data?.data?.id || '');
  t.assertOk(Boolean(requestId), 'swift deletion request created for rejection path');

  await t.logout();
  await t.loginAdmin();

  await t.request('POST', '/api/deletion', {
    json: {
      action: 'reject',
      requestId,
    },
    expectedStatus: 200,
  });
  t.step('admin can reject swift deletion request');

  const rejectedRequestList = await t.request('GET', '/api/deletion', { expectedStatus: 200 });
  const rejectedRequest = (Array.isArray(rejectedRequestList.data?.data) ? rejectedRequestList.data.data : []).find((row) => row.id === requestId);
  t.assertEqual(rejectedRequest?.status, 'REJECTED', 'rejected deletion request stays recorded');

  const swiftAfterReject = await t.request('GET', `/api/swift?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const stillBankSwift = findSwiftByDetail(swiftAfterReject.data?.data, linkedDetail.id);
  t.assertEqual(stillBankSwift?.status, 'Bank_Transfer', 'swift remains Bank_Transfer after rejection');

  const receiptAfterReject = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const stillBankReceipt = findReceiptByOrder(receiptAfterReject.data?.data, orderNo);
  t.assertEqual(stillBankReceipt?.status, 'Bank_Transfer', 'receipt remains Bank_Transfer after rejection');

  const detailAfterReject = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const stillBankDetail = findDetailByOrder(detailAfterReject.data?.data, orderNo);
  t.assertEqual(stillBankDetail?.status, 'Bank_Transfer', 'detail remains Bank_Transfer after rejection');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId: linkedReceipt.id,
    },
    expectedStatus: 200,
  });
  t.step('receipt marked as received after bank transfer');

  const receiptAfterReceive = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedReceipt = findReceiptByOrder(receiptAfterReceive.data?.data, orderNo);
  t.assertEqual(receivedReceipt?.status, 'RECEIVED', 'receipt enters RECEIVED after mark-received');

  const detailAfterReceive = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedDetail = findDetailByOrder(detailAfterReceive.data?.data, orderNo);
  t.assertEqual(receivedDetail?.status, 'RECEIVED', 'detail enters RECEIVED after linked receipts are received');

  const swiftAfterReceive = await t.request('GET', `/api/swift?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedSwift = findSwiftByDetail(swiftAfterReceive.data?.data, linkedDetail.id);
  t.assertEqual(receivedSwift?.status, 'RECEIVED', 'swift enters RECEIVED after receipt sign-off');

  const receiptDeleteForbidden = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'RECEIPT',
      targetId: linkedReceipt.id,
    },
    expectedStatus: 400,
  });
  t.assertMatch(receiptDeleteForbidden.data?.error || receiptDeleteForbidden.text, /RECEIVED/, 'receipt deletion is blocked once received');

  const detailDeleteForbidden = await t.request('POST', '/api/deletion', {
    json: {
      action: 'request',
      targetType: 'DETAIL',
      targetId: linkedDetail.id,
    },
    expectedStatus: 400,
  });
  t.assertMatch(detailDeleteForbidden.data?.error || detailDeleteForbidden.text, /RECEIVED/, 'detail deletion is blocked once received');

  await t.logout();
}
