import { writeFileSync } from 'node:fs';

export const name = 'receipt-generator-flow';

function findReceiptByNo(rows, receiptNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.receiptNo === receiptNo);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('receipt-generator');
  const salesEmail = `${suffix}-sales@example.com`;
  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sales ${suffix}`,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'sales user created');

  const orderName = `SIGNED-${suffix}`;
  const orderNo = `${orderName}-07`;
  const customerMark = `SIGNED-MARK-${suffix}`;
  const invoiceNo = `SIGNED-INV-${suffix}`;
  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: customerMark,
      orderName,
      name: `Signed Customer ${suffix}`,
      phone: `628${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNo,
      orders: [
        { orderNo, amount: 2500, customerMark: customerMark, customerName: customerMark },
      ],
    },
    expectedStatus: 200,
  });

  const context = await t.request('GET', `/api/receipt-generator?action=order-context&orderNo=${encodeURIComponent(orderNo)}&usdAmount=2500`, {
    expectedStatus: 200,
  });
  t.assertEqual(context.data?.data?.invNo, invoiceNo, 'generator order context resolves invoice');
  t.assertEqual(context.data?.data?.customer?.mark, customerMark, 'generator order context resolves customer');
  t.assertEqual(context.data?.data?.preview?.balanceAfter, 0, 'generator preview computes balance after');

  const createSession = await t.request('POST', '/api/receipt-generator', {
    json: {
      action: 'create-session',
      orderNo,
      usdAmount: 2500,
    },
    expectedStatus: 200,
  });
  const sessionId = String(createSession.data?.data?.sessionId || '');
  const initialReceiptNo = String(createSession.data?.data?.receiptNo || '');
  const receiptId = String(createSession.data?.data?.receiptId || '');
  t.assertOk(Boolean(sessionId), 'generator session created');
  t.assertEqual(initialReceiptNo, '0010000', 'first generator receipt uses atomic receipt number starting at 0010000');

  const receiptListBeforeFinalize = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const pendingReceipt = findReceiptByNo(receiptListBeforeFinalize.data?.data, initialReceiptNo);
  t.assertEqual(pendingReceipt?.status, 'SIGNING_PENDING', 'pending receipt is visible before signature finalization');

  const pendingWorkflowBlocked = await t.request('POST', '/api/receipt', {
    json: {
      action: 'mark-received',
      receiptId,
    },
    expectedStatus: 400,
  });
  t.assertEqual(pendingWorkflowBlocked.data?.code, 'BAD_REQUEST', 'pending signed receipt cannot enter business workflow early');

  const editedReceiptNo = '0010099';
  const editedPayer = `Edited Signed Customer ${suffix} "${customerMark}"`;
  const editedPhone = '620000099';
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId,
      data: {
        receiptNo: editedReceiptNo,
        date: '2026-08-26',
        orderNo,
        invNo: invoiceNo,
        customerMark,
        payer: editedPayer,
        tel: editedPhone,
      },
    },
    expectedStatus: 200,
  });

  const resumedDraft = await t.request('GET', `/api/receipt-generator?action=resume-by-receipt&receiptId=${encodeURIComponent(receiptId)}`, {
    expectedStatus: 200,
  });
  t.assertEqual(resumedDraft.data?.data?.layout?.receiptNo, editedReceiptNo, 'resumed draft uses edited receipt number');
  t.assertEqual(resumedDraft.data?.data?.layout?.dateText, '26/08/2026', 'resumed draft uses edited payment date');
  t.assertEqual(resumedDraft.data?.data?.layout?.clientName, editedPayer, 'resumed draft uses edited payer');
  t.assertEqual(resumedDraft.data?.data?.layout?.clientTel, editedPhone, 'resumed draft uses edited phone');
  t.assertEqual(resumedDraft.data?.data?.layout?.orderNo, orderNo, 'resumed draft keeps the matched ORDER NO');
  t.assertEqual(resumedDraft.data?.data?.layout?.invNo, invoiceNo, 'resumed draft keeps the matched INV NO');
  t.assertEqual(resumedDraft.data?.data?.layout?.balanceBefore, 2500, 'resumed draft recalculates live balance before payment');
  t.assertEqual(resumedDraft.data?.data?.layout?.balanceAfter, 0, 'resumed draft recalculates balance after payment');

  const receiptListAfterEdit = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const editedPendingReceipt = findReceiptByNo(receiptListAfterEdit.data?.data, editedReceiptNo);
  t.assertEqual(editedPendingReceipt?.status, 'SIGNING_PENDING', 'edited draft stays SIGNING_PENDING until signatures are finalized');

  const tinyPngPath = t.writeTempFile(`receipt-generator-${suffix}.png`, '');
  writeFileSync(
    tinyPngPath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnKXuQAAAAASUVORK5CYII=', 'base64'),
  );

  const finalize = await t.request('POST', '/api/receipt-generator', {
    form: {
      action: 'finalize',
      sessionId,
      layoutSnapshot: JSON.stringify(resumedDraft.data?.data?.layout || {}),
      receiptImage: {
        filePath: tinyPngPath,
        filename: `${editedReceiptNo}.png`,
        contentType: 'image/png',
      },
      receiverSignature: {
        filePath: tinyPngPath,
        filename: `${editedReceiptNo}-receiver.png`,
        contentType: 'image/png',
      },
      payerSignature: {
        filePath: tinyPngPath,
        filename: `${editedReceiptNo}-payer.png`,
        contentType: 'image/png',
      },
    },
    expectedStatus: 200,
  });
  t.assertEqual(finalize.data?.data?.receiptStatus, 'SR_Received', 'finalize moves receipt into normal SR_Received state');

  const sessionAfterFinalize = await t.request('GET', `/api/receipt-generator?action=session&sessionId=${encodeURIComponent(sessionId)}`, {
    expectedStatus: 200,
  });
  t.assertEqual(sessionAfterFinalize.data?.data?.status, 'FINALIZED', 'generator session becomes FINALIZED after signature completion');
  t.assertMatch(sessionAfterFinalize.data?.data?.finalImageUrl || '', /\/upload\/images\/receipts\/generated\//, 'final image stored under generated receipt directory');

  const receiptListAfterFinalize = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const finalizedReceipt = findReceiptByNo(receiptListAfterFinalize.data?.data, editedReceiptNo);
  t.assertEqual(finalizedReceipt?.status, 'SR_Received', 'receipt leaves SIGNING_PENDING after finalize');
  t.assertMatch(finalizedReceipt?.imageUrl || '', /\/upload\/images\/receipts\/generated\//, 'finalized receipt stores generated receipt image');

  const contextAfterFinalize = await t.request('GET', `/api/receipt-generator?action=order-context&orderNo=${encodeURIComponent(orderNo)}&usdAmount=1`, {
    expectedStatus: 200,
  });
  t.assertEqual(contextAfterFinalize.data?.data?.balanceBefore, 0, 'generator context reflects finalized receipt balance');

  const resumeAfterFinalize = await t.request('GET', `/api/receipt-generator?action=resume-by-receipt&receiptId=${encodeURIComponent(receiptId)}`, {
    expectedStatus: 404,
  });
  t.assertEqual(resumeAfterFinalize.data?.code, 'RESOURCE_NOT_FOUND', 'finalized receipt no longer has a resumable pending session');
}
