import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Webhook } from 'standardwebhooks';

export const name = 'email-delivery-workflow';

function rows(response) {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

function findOrder(invoiceResponse, orderNo) {
  for (const invoice of rows(invoiceResponse)) {
    const order = (Array.isArray(invoice.orders) ? invoice.orders : [])
      .find((candidate) => candidate.orderNo === orderNo);
    if (order) return { invoice, order };
  }
  return null;
}

async function fakeResendControl(pathname, options = {}) {
  const baseUrl = process.env.RESEND_FAKE_CONTROL_BASE_URL;
  assert.ok(baseUrl, 'RESEND_FAKE_CONTROL_BASE_URL must be configured by the isolated test harness');
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      'x-control-token': process.env.RESEND_FAKE_CONTROL_TOKEN || '',
      ...(options.json === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
  const body = await response.json();
  assert.equal(response.status, options.expectedStatus || 200, JSON.stringify(body));
  return body;
}

async function listNotifications(t, search = '') {
  const query = new URLSearchParams({ page: '1', pageSize: '100' });
  if (search) query.set('search', search);
  return t.request('GET', `/api/email-notifications?${query.toString()}`, { expectedStatus: 200 });
}

async function createCustomer(t, input) {
  const response = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: input.mark,
      orderName: input.orderName,
      name: input.name,
      companyName: input.companyName,
      phone: input.phone,
      city: 'Conakry',
      ownerId: input.ownerId,
    },
    expectedStatus: 200,
  });
  return String(response.data?.data?.id || '');
}

async function addCustomerEmail(t, customerId, email) {
  const response = await t.request('POST', '/api/customer-notification-emails', {
    json: { action: 'add', customerId, email },
    expectedStatus: 200,
  });
  return String(response.data?.data?.id || '');
}

async function createDirectReceipt(t, input) {
  const response = await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: input.receiptNo,
      date: input.date || '2026-09-01',
      usd: input.amount,
      orderNo: input.orderNo,
      invNo: input.invNo || null,
      customerId: input.customerId,
      customerMark: input.mark,
      customerName: input.customerName,
      isDeposit: false,
    },
    expectedStatus: 200,
  });
  return response.data?.data;
}

async function finalizeSignedReceipt(t, input) {
  const session = await t.request('POST', '/api/receipt-generator', {
    json: {
      action: 'create-session',
      orderNo: input.orderNo,
      usdAmount: input.amount,
    },
    expectedStatus: 200,
  });
  const sessionId = String(session.data?.data?.sessionId || '');
  const receiptId = String(session.data?.data?.receiptId || '');
  const receiptNo = String(session.data?.data?.receiptNo || '');
  t.assertOk(Boolean(sessionId && receiptId && receiptNo), 'signed receipt draft created');

  const beforeFinalize = await listNotifications(t, receiptNo);
  t.assertEqual(rows(beforeFinalize).length, 0, 'signed receipt draft creates no email task');

  const resumed = await t.request(
    'GET',
    `/api/receipt-generator?action=resume-by-receipt&receiptId=${encodeURIComponent(receiptId)}`,
    { expectedStatus: 200 },
  );
  const tinyPngPath = t.writeTempFile(`signed-${input.suffix}.png`, '');
  writeFileSync(
    tinyPngPath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnKXuQAAAAASUVORK5CYII=', 'base64'),
  );
  await t.request('POST', '/api/receipt-generator', {
    form: {
      action: 'finalize',
      sessionId,
      layoutSnapshot: JSON.stringify(resumed.data?.data?.layout || {}),
      receiptImage: { filePath: tinyPngPath, filename: `${receiptNo}.png`, contentType: 'image/png' },
      receiverSignature: { filePath: tinyPngPath, filename: `${receiptNo}-receiver.png`, contentType: 'image/png' },
      payerSignature: { filePath: tinyPngPath, filename: `${receiptNo}-payer.png`, contentType: 'image/png' },
    },
    expectedStatus: 200,
  });
  const afterFinalize = await listNotifications(t, receiptNo);
  const task = rows(afterFinalize).find((row) => row.receiptNo === receiptNo);
  t.assertEqual(task?.status, 'PENDING', 'signed receipt creates its task only after finalization');
  return { receiptId, receiptNo, task };
}

async function sendWebhook(t, input) {
  const payload = JSON.stringify({
    type: input.type,
    created_at: input.createdAt,
    data: {
      email_id: input.providerMessageId,
      from: 'MU LEDGER <sender@example.com>',
      to: ['test-destination@example.com'],
      subject: 'Isolated test message',
      created_at: input.createdAt,
    },
  });
  const timestamp = new Date(input.createdAt);
  const webhook = new Webhook(process.env.RESEND_WEBHOOK_SECRET || '');
  const signature = webhook.sign(input.eventId, timestamp, payload);
  return t.request('POST', '/api/webhooks/resend', {
    headers: {
      'content-type': 'application/json',
      'svix-id': input.eventId,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
    json: JSON.parse(payload),
    expectedStatus: 200,
  });
}

export default async function run(t) {
  await fakeResendControl('/__control/reset', { method: 'POST', json: {} });
  t.step('fake Resend provider is isolated, ready, and reset');

  await t.initAdmin();
  await t.loginAdmin();
  const suffix = t.unique('email-delivery');
  const sales = await t.createUser({
    email: `${suffix}-sales@example.com`,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Email Delivery Sales ${suffix}`,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'email workflow SALES owner created');

  const customerA = {
    mark: `EDA-${suffix}`.toUpperCase(),
    orderName: `EMAIL-A-${suffix}`.toUpperCase(),
    name: `Email Delivery Customer A ${suffix}`,
    companyName: `Email Delivery Company A ${suffix}`,
    phone: `622${Math.floor(Math.random() * 900000 + 100000)}`,
  };
  const customerB = {
    mark: `EDB-${suffix}`.toUpperCase(),
    orderName: `EMAIL-B-${suffix}`.toUpperCase(),
    name: `Email Delivery Customer B ${suffix}`,
    companyName: `Email Delivery Company B ${suffix}`,
    phone: `623${Math.floor(Math.random() * 900000 + 100000)}`,
  };
  const customerAId = await createCustomer(t, { ...customerA, ownerId: salesId });
  const customerBId = await createCustomer(t, { ...customerB, ownerId: salesId });
  await addCustomerEmail(t, customerAId, `${suffix}-a-primary@example.com`);
  await addCustomerEmail(t, customerAId, `${suffix}-a-copy@example.com`);
  await addCustomerEmail(t, customerBId, `${suffix}-b-primary@example.com`);
  t.assertOk(Boolean(customerAId && customerBId), 'customers and notification recipients created');

  const orderA = `${customerA.orderName}-01`;
  const orderB = `${customerB.orderName}-01`;
  const invoiceNo = `EMAIL-INV-${suffix}`.toUpperCase();
  const invoice = await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNo,
      orders: [
        { orderNo: orderA, amount: 5000, customerId: customerAId, customerMark: customerA.mark, customerName: customerA.orderName },
        { orderNo: orderB, amount: 6000, customerId: customerBId, customerMark: customerB.mark, customerName: customerB.orderName },
      ],
    },
    expectedStatus: 200,
  });
  const invoiceId = String(invoice.data?.data?.id || '');
  t.assertOk(Boolean(invoiceId), 'multi-customer invoice created without dates');

  const directReceiptNo = `EMAIL-DIRECT-${suffix}`.toUpperCase();
  await createDirectReceipt(t, {
    receiptNo: directReceiptNo,
    amount: 500,
    orderNo: orderA,
    invNo: invoiceNo,
    customerId: customerAId,
    mark: customerA.mark,
    customerName: customerA.name,
  });
  const directTask = rows(await listNotifications(t, directReceiptNo))[0];
  t.assertEqual(directTask?.type, 'PAYMENT_RECEIVED', 'direct receipt creates one payment task');

  const detailOrderNo = `${customerB.orderName}-DETAIL`;
  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      date: '2026-09-01',
      items: [{ mark: customerB.mark, orderNo: detailOrderNo, amount: 650 }],
    },
    expectedStatus: 200,
  });
  const detailTasks = rows(await listNotifications(t, detailOrderNo));
  t.assertEqual(detailTasks.length, 1, 'detail-created receipt creates exactly one payment task');
  t.assertEqual(detailTasks[0]?.type, 'PAYMENT_RECEIVED', 'detail-created receipt task has payment type');

  await finalizeSignedReceipt(t, { suffix, orderNo: orderA, amount: 700 });

  const transferSourceOrderNo = `${customerA.orderName}-TRANSFER-SOURCE`;
  const transferSourceReceiptNo = `EMAIL-TRANSFER-SOURCE-${suffix}`.toUpperCase();
  await createDirectReceipt(t, {
    receiptNo: transferSourceReceiptNo,
    amount: 300,
    orderNo: transferSourceOrderNo,
    customerId: customerAId,
    mark: customerA.mark,
    customerName: customerA.name,
  });
  const paymentCountBeforeTransfer = rows(await listNotifications(t))
    .filter((row) => row.type === 'PAYMENT_RECEIVED').length;
  const sourceInvoiceSearch = await t.request(
    'GET',
    `/api/invoice?search=${encodeURIComponent(transferSourceOrderNo)}`,
    { expectedStatus: 200 },
  );
  const sourceOrder = findOrder(sourceInvoiceSearch, transferSourceOrderNo)?.order;
  t.assertOk(Boolean(sourceOrder?.id), 'balance transfer source pool order is available');
  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'transferBalance',
      fromOrderId: sourceOrder.id,
      toOrderNo: orderB,
      transferAmount: 300,
    },
    expectedStatus: 200,
  });
  const paymentTasksAfterTransfer = rows(await listNotifications(t))
    .filter((row) => row.type === 'PAYMENT_RECEIVED');
  t.assertEqual(paymentTasksAfterTransfer.length, paymentCountBeforeTransfer, 'balance transfer creates no additional payment task');
  t.assertOk(
    paymentTasksAfterTransfer.every((row) => !String(row.receiptNo || '').startsWith('TRANSFER-')),
    'no TRANSFER receipt appears in the email queue',
  );

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateInvoiceDates',
      invoiceId,
      shipDate: '2026-08-20',
      releaseDate: '2026-08-30',
    },
    expectedStatus: 200,
  });
  const allAfterDates = rows(await listNotifications(t));
  t.assertEqual(allAfterDates.length, 8, 'four payment tasks plus four customer-scoped invoice tasks are projected');
  const invoiceTasks = allAfterDates.filter((row) => row.invoiceId === invoiceId);
  t.assertEqual(invoiceTasks.filter((row) => row.type === 'SHIPMENT').length, 2, 'shipment creates one task per invoice customer');
  t.assertEqual(invoiceTasks.filter((row) => row.type === 'RELEASE').length, 2, 'release creates one task per invoice customer');
  for (const task of invoiceTasks) {
    const orderNos = Array.isArray(task.currentSnapshot?.orderNos) ? task.currentSnapshot.orderNos : [];
    const expectedOrders = task.customerId === customerAId ? [orderA] : [orderB];
    t.assertEqual(JSON.stringify(orderNos), JSON.stringify(expectedOrders), `invoice task ${task.id} contains only its customer's orders`);
  }

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateInvoiceDates',
      invoiceId,
      shipDate: '2026-08-20',
      releaseDate: '2026-08-30',
    },
    expectedStatus: 200,
  });
  t.assertEqual(rows(await listNotifications(t)).length, 8, 'repeated invoice date save does not duplicate tasks');

  const disabledApproval = await t.request('POST', '/api/email-notifications', {
    json: { action: 'approve', notificationIds: [directTask.id] },
    expectedStatus: 409,
  });
  t.assertEqual(disabledApproval.data?.code, 'EMAIL_OUTBOUND_DISABLED', 'approval is blocked while outbound delivery is disabled');

  await t.request('POST', '/api/email-settings', {
    json: {
      action: 'save-settings',
      settings: {
        outboundEnabled: true,
        recipientMode: 'SEPARATE',
        senderName: 'MU LEDGER',
        senderAddress: 'sender@example.com',
        replyToAddress: 'reply@example.com',
        retryLimit: 1,
        retryIntervalsSeconds: [1],
        testModeEnabled: true,
        testDestination: 'test-destination@example.com',
        logoUrl: 'https://127.0.0.1/isolated-test-logo.svg',
      },
    },
    expectedStatus: 200,
  });
  const preview = await t.request('POST', '/api/email-notifications', {
    json: { action: 'preview', notificationId: directTask.id },
    expectedStatus: 200,
  });
  t.assertEqual(preview.data?.testModeRedirected, true, 'preview explicitly reports test-mode redirection');
  t.assertEqual(preview.data?.intendedRecipients?.length, 2, 'separate mode preserves two intended customer recipients');
  t.assertOk(
    preview.data?.actualRecipients?.every((item) => item.to?.[0] === 'test-destination@example.com'),
    'test mode redirects every actual delivery to the safe test destination',
  );

  const approval = await t.request('POST', '/api/email-notifications', {
    json: { action: 'approve', notificationIds: [directTask.id] },
    expectedStatus: 200,
  });
  t.assertEqual(approval.data?.deliveryCount, 2, 'ADMIN approval freezes one delivery per separate recipient');
  const firstKey = `email-delivery:${directTask.id}:1`;
  const secondKey = `email-delivery:${directTask.id}:2`;
  await fakeResendControl('/__control/configure', {
    method: 'POST',
    json: { rejectedIdempotencyKeys: [secondKey] },
  });

  const firstDispatch = await t.request('POST', '/api/internal/email-delivery/dispatch', {
    headers: {
      'x-maintenance-token': process.env.MAINTENANCE_JOB_TOKEN || '',
      'x-email-delivery-batch-size': '10',
    },
    expectedStatus: 200,
  });
  t.assertEqual(firstDispatch.data?.data?.sent, 1, 'first dispatch accepts one recipient');
  t.assertEqual(firstDispatch.data?.data?.failed, 1, 'first dispatch records one definite rejection');

  const firstRequests = (await fakeResendControl('/__control/requests')).requests;
  t.assertEqual(firstRequests.length, 2, 'fake provider receives exactly two separate delivery requests');
  t.assertOk(firstRequests.every((item) => item.authorizationPresent), 'provider authorization is present without exposing its value');
  t.assertOk(
    firstRequests.every((item) => item.body?.to?.[0] === 'test-destination@example.com'),
    'provider payloads use only the test destination',
  );
  t.assertEqual(new Set(firstRequests.map((item) => item.idempotencyKey)).size, 2, 'provider receives stable unique idempotency keys');

  const duplicateDispatch = await t.request('POST', '/api/internal/email-delivery/dispatch', {
    headers: {
      'x-maintenance-token': process.env.MAINTENANCE_JOB_TOKEN || '',
      'x-email-delivery-batch-size': '10',
    },
    expectedStatus: 200,
  });
  t.assertEqual(duplicateDispatch.data?.data?.candidates, 0, 'immediate duplicate dispatch has no eligible delivery');
  t.assertEqual((await fakeResendControl('/__control/requests')).requests.length, 2, 'duplicate dispatch does not call the provider again');

  const partial = rows(await listNotifications(t, directReceiptNo))[0];
  t.assertEqual(partial?.deliveries?.filter((item) => item.status === 'SENT').length, 1, 'accepted recipient remains sent');
  t.assertEqual(partial?.deliveries?.filter((item) => item.status === 'FAILED').length, 1, 'rejected recipient remains failed');

  const retry = await t.request('POST', '/api/email-notifications', {
    json: { action: 'retry', notificationId: directTask.id },
    expectedStatus: 200,
  });
  t.assertEqual(retry.data?.retriedCount, 1, 'ADMIN retry queues only the failed recipient');
  await fakeResendControl('/__control/configure', {
    method: 'POST',
    json: { rejectedIdempotencyKeys: [] },
  });
  const retryDispatch = await t.request('POST', '/api/internal/email-delivery/dispatch', {
    headers: {
      'x-maintenance-token': process.env.MAINTENANCE_JOB_TOKEN || '',
      'x-email-delivery-batch-size': '10',
    },
    expectedStatus: 200,
  });
  t.assertEqual(retryDispatch.data?.data?.sent, 1, 'retry dispatch accepts the previously failed recipient');
  const allProviderRequests = (await fakeResendControl('/__control/requests')).requests;
  t.assertEqual(allProviderRequests.filter((item) => item.idempotencyKey === firstKey).length, 1, 'successful recipient is never retried');
  t.assertEqual(allProviderRequests.filter((item) => item.idempotencyKey === secondKey).length, 2, 'only failed recipient is retried with the same idempotency key');

  const attempts = await t.request(
    'GET',
    `/api/email-notifications?action=attempts&notificationId=${encodeURIComponent(directTask.id)}`,
    { expectedStatus: 200 },
  );
  t.assertEqual(rows(attempts).length, 3, 'delivery history records both initial attempts and the single retry');

  const acceptedRequest = allProviderRequests.find((item) => item.idempotencyKey === firstKey);
  const providerMessageId = String(acceptedRequest?.providerMessageId || '');
  t.assertOk(Boolean(providerMessageId), 'fake provider exposes the accepted message id for webhook verification');
  const eventId = `evt-${suffix}`;
  const deliveredAt = new Date().toISOString();
  const webhook = await sendWebhook(t, {
    eventId,
    type: 'email.delivered',
    providerMessageId,
    createdAt: deliveredAt,
  });
  t.assertEqual(webhook.data?.data?.applied, true, 'signed provider webhook advances the matching delivery');
  const duplicateWebhook = await sendWebhook(t, {
    eventId,
    type: 'email.delivered',
    providerMessageId,
    createdAt: deliveredAt,
  });
  t.assertEqual(duplicateWebhook.data?.data?.duplicate, true, 'duplicate signed webhook event is applied only once');

  const afterWebhook = rows(await listNotifications(t, directReceiptNo))[0];
  t.assertEqual(afterWebhook?.deliveries?.filter((item) => item.status === 'DELIVERED').length, 1, 'webhook marks exactly one provider delivery as delivered');

  await t.logout();
}
