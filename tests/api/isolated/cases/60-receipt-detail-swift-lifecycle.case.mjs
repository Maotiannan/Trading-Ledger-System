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
  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Lifecycle ${suffix}`,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.step('lifecycle sales account created');

  const strictOrderName = `STRICT-${suffix}`;
  const strictExistingOrderNo = `${strictOrderName}-07`;
  const strictUnknownOrderNo = `${strictOrderName}-13B`;
  const strictCustomerMark = `STRICT-MARK-${suffix}`;
  const strictCompanyName = `Strict Company ${suffix}`;
  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: strictCustomerMark,
      orderName: strictOrderName,
      name: `Strict Customer ${suffix}`,
      companyName: strictCompanyName,
      phone: `629${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.step('strict receipt matching customer created');

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: `STRICT-INV-${suffix}`,
      orders: [
        { orderNo: strictExistingOrderNo, amount: 999, customerMark: strictCustomerMark, customerName: strictOrderName },
      ],
    },
    expectedStatus: 200,
  });
  t.step('strict receipt matching existing invoice order created');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-STRICT-${suffix}`,
      usd: 111,
      invNo: `OCR-INV-${suffix}`,
      orderNo: strictUnknownOrderNo,
      payer: strictCustomerMark,
      customerMark: strictCustomerMark,
      customerName: strictOrderName,
    },
    expectedStatus: 200,
  });
  t.step('unregistered receipt order created without fuzzy invoice match');

  const strictReceiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(strictUnknownOrderNo)}`, { expectedStatus: 200 });
  const strictReceipt = findReceiptByOrder(strictReceiptList.data?.data, strictUnknownOrderNo);
  t.assertOk(Boolean(strictReceipt?.id), 'unregistered receipt is queryable by its own order');
  t.assertEqual(strictReceipt?.invNo, null, 'unregistered receipt clears OCR invoice number');
  t.assertEqual(strictReceipt?.payer, `${strictCompanyName} "${strictCustomerMark}"`, 'unregistered receipt payer uses company name plus mark');
  t.assertEqual(strictReceipt?.order?.orderNo, strictUnknownOrderNo, 'unregistered receipt keeps its own order instead of existing same-prefix order');
  t.assertEqual(strictReceipt?.order?.invoice?.invNo, 'Un_Associated', 'unregistered non-deposit receipt enters Un_Associated pool');

  const adminOnlyOrderNo = `ADMINONLY-${suffix}-01`;
  const adminOnlyMark = `ADMINONLY-${suffix}`;
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-ADMIN-${suffix}`,
      usd: 180,
      orderNo: adminOnlyOrderNo,
      customerMark: adminOnlyMark,
      customerName: adminOnlyMark,
    },
    expectedStatus: 200,
  });
  t.step('admin-only completion receipt created');

  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ mark: adminOnlyMark, orderNo: adminOnlyOrderNo, amount: 180 }],
    },
    expectedStatus: 200,
  });
  t.step('admin-only completion detail created');

  const adminOnlyReceiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(adminOnlyOrderNo)}`, { expectedStatus: 200 });
  const adminOnlyReceipt = findReceiptByOrder(adminOnlyReceiptList.data?.data, adminOnlyOrderNo);
  t.assertEqual(adminOnlyReceipt?.status, 'Waiting_SWIFT', 'admin-only receipt enters Waiting_SWIFT after detail creation');

  const salesMarkReceivedForbidden = await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId: adminOnlyReceipt.id,
    },
    expectedStatus: 403,
  });
  t.assertMatch(salesMarkReceivedForbidden.data?.code || salesMarkReceivedForbidden.text, /FORBIDDEN/, 'sales cannot finalize receipt completion');

  await t.logout();
  await t.loginAdmin();

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId: adminOnlyReceipt.id,
    },
    expectedStatus: 200,
  });
  t.step('admin can finalize waiting receipt before swift');

  const adminOnlyReceiptAfter = await t.request('GET', `/api/receipt?search=${encodeURIComponent(adminOnlyOrderNo)}`, { expectedStatus: 200 });
  const adminOnlyReceived = findReceiptByOrder(adminOnlyReceiptAfter.data?.data, adminOnlyOrderNo);
  t.assertEqual(adminOnlyReceived?.status, 'RECEIVED', 'admin-only receipt enters RECEIVED after admin completion');

  const adminOnlyDetailAfter = await t.request('GET', `/api/detail?search=${encodeURIComponent(adminOnlyOrderNo)}`, { expectedStatus: 200 });
  const adminOnlyReceivedDetail = findDetailByOrder(adminOnlyDetailAfter.data?.data, adminOnlyOrderNo);
  t.assertEqual(adminOnlyReceivedDetail?.status, 'RECEIVED', 'single-receipt detail enters RECEIVED after admin completion');

  const multiOrderNo = `MULTI-${suffix}-01`;
  const multiMark = `MULTI-${suffix}`;
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-MULTI-A-${suffix}`,
      usd: 100,
      orderNo: multiOrderNo,
      customerMark: multiMark,
      customerName: multiMark,
    },
    expectedStatus: 200,
  });
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-MULTI-B-${suffix}`,
      usd: 120,
      orderNo: multiOrderNo,
      customerMark: multiMark,
      customerName: multiMark,
    },
    expectedStatus: 200,
  });
  t.step('multi-receipt scenario receipts created');

  const multiReceiptListBefore = await t.request('GET', `/api/receipt?search=${encodeURIComponent(multiOrderNo)}`, { expectedStatus: 200 });
  const multiReceipts = Array.isArray(multiReceiptListBefore.data?.data)
    ? multiReceiptListBefore.data.data.filter((row) => row.orderNo === multiOrderNo)
    : [];
  t.assertEqual(multiReceipts.length, 2, 'multi-receipt scenario has two receipts');

  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: multiReceipts.map((row) => ({
        mark: multiMark,
        orderNo: multiOrderNo,
        amount: Number(row.usd),
        receiptId: row.id,
      })),
    },
    expectedStatus: 200,
  });
  t.step('multi-receipt detail created with explicit receipt links');

  const multiDetailBefore = await t.request('GET', `/api/detail?search=${encodeURIComponent(multiOrderNo)}`, { expectedStatus: 200 });
  const multiDetail = findDetailByOrder(multiDetailBefore.data?.data, multiOrderNo);
  t.assertEqual(multiDetail?.status, 'Waiting_SWIFT', 'multi-receipt detail starts in Waiting_SWIFT');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId: multiReceipts[0].id,
    },
    expectedStatus: 200,
  });
  t.step('admin completes first receipt in multi-receipt detail');

  const multiAfterFirstReceipt = await t.request('GET', `/api/receipt?search=${encodeURIComponent(multiOrderNo)}`, { expectedStatus: 200 });
  const firstPassReceipts = Array.isArray(multiAfterFirstReceipt.data?.data)
    ? multiAfterFirstReceipt.data.data.filter((row) => row.orderNo === multiOrderNo)
    : [];
  t.assertEqual(firstPassReceipts.filter((row) => row.status === 'RECEIVED').length, 1, 'only one receipt is received after first admin completion');

  const multiDetailAfterFirst = await t.request('GET', `/api/detail?search=${encodeURIComponent(multiOrderNo)}`, { expectedStatus: 200 });
  const stillWaitingDetail = findDetailByOrder(multiDetailAfterFirst.data?.data, multiOrderNo);
  t.assertEqual(stillWaitingDetail?.status, 'Waiting_SWIFT', 'multi-receipt detail stays waiting until all receipts complete');

  const secondReceipt = firstPassReceipts.find((row) => row.status !== 'RECEIVED');
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId: secondReceipt.id,
    },
    expectedStatus: 200,
  });
  t.step('admin completes second receipt in multi-receipt detail');

  const multiDetailAfterSecond = await t.request('GET', `/api/detail?search=${encodeURIComponent(multiOrderNo)}`, { expectedStatus: 200 });
  const receivedMultiDetail = findDetailByOrder(multiDetailAfterSecond.data?.data, multiOrderNo);
  t.assertEqual(receivedMultiDetail?.status, 'RECEIVED', 'multi-receipt detail enters RECEIVED only after all receipts complete');

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

  const salesSwiftReceiveForbidden = await t.request('POST', '/api/swift', {
    json: {
      action: 'mark-received',
      swiftId: createdSwift.id,
    },
    expectedStatus: 403,
  });
  t.assertMatch(salesSwiftReceiveForbidden.data?.code || salesSwiftReceiveForbidden.text, /FORBIDDEN/, 'sales cannot sign off swift received state');

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

  await t.request('POST', '/api/swift', {
    json: {
      action: 'mark-received',
      swiftId: createdSwift.id,
    },
    expectedStatus: 200,
  });
  t.step('swift signed off as received after bank transfer');

  const receiptAfterReceive = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedReceipt = findReceiptByOrder(receiptAfterReceive.data?.data, orderNo);
  t.assertEqual(receivedReceipt?.status, 'RECEIVED', 'receipt enters RECEIVED after swift sign-off');

  const detailAfterReceive = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedDetail = findDetailByOrder(detailAfterReceive.data?.data, orderNo);
  t.assertEqual(receivedDetail?.status, 'RECEIVED', 'detail enters RECEIVED after swift sign-off');

  const swiftAfterReceive = await t.request('GET', `/api/swift?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const receivedSwift = findSwiftByDetail(swiftAfterReceive.data?.data, linkedDetail.id);
  t.assertEqual(receivedSwift?.status, 'RECEIVED', 'swift enters RECEIVED after swift sign-off');

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
