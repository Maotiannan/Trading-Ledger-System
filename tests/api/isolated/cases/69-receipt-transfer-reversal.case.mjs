export const name = 'receipt-transfer-reversal';

const INCIDENT_AMOUNT = 3213;
const TARGET_AMOUNT = 13666;
const EXPECTED_TARGET_BALANCE = 10453;

function receiptRows(response) {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

function invoiceRows(response) {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

function detailRows(response) {
  return Array.isArray(response.data?.data) ? response.data.data : [];
}

async function listReceipts(t, search) {
  const response = await t.request(
    'GET',
    `/api/receipt?search=${encodeURIComponent(search)}`,
    { expectedStatus: 200 },
  );
  return receiptRows(response);
}

async function findReceipt(t, search, predicate) {
  return (await listReceipts(t, search)).find(predicate) || null;
}

async function findOrder(t, orderNo) {
  const response = await t.request(
    'GET',
    `/api/invoice?search=${encodeURIComponent(orderNo)}`,
    { expectedStatus: 200 },
  );
  for (const invoice of invoiceRows(response)) {
    const order = (Array.isArray(invoice.orders) ? invoice.orders : [])
      .find((candidate) => candidate.orderNo === orderNo);
    if (order) return { invoice, order };
  }
  return null;
}

async function createInvoiceOrder(t, { invNo, orderNo, amount, mark }) {
  await t.request('POST', '/api/invoice', {
    json: {
      invNo,
      orders: [{
        orderNo,
        amount,
        customerMark: mark,
        customerName: mark,
      }],
    },
    expectedStatus: 200,
  });
  const created = await findOrder(t, orderNo);
  t.assertOk(Boolean(created?.order?.id), `invoice order ${orderNo} is available`);
  return created;
}

async function createReceipt(t, { receiptNo, orderNo, amount, mark, date = '2026-07-01' }) {
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo,
      usd: amount,
      orderNo,
      customerMark: mark,
      customerName: mark,
      payer: `PAYER ${mark}`,
      tel: '622000000',
      date,
      isDeposit: false,
    },
    expectedStatus: 200,
  });
  const created = await findReceipt(t, receiptNo, (row) => row.receiptNo === receiptNo);
  t.assertOk(Boolean(created?.id), `receipt ${receiptNo} is available`);
  return created;
}

async function transferBalance(t, { sourceOrderId, targetOrderNo, amount }) {
  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'transferBalance',
      fromOrderId: sourceOrderId,
      toOrderNo: targetOrderNo,
      transferAmount: amount,
    },
    expectedStatus: 200,
  });
}

async function createTransferFixture(t, suffix, variant, options = {}) {
  const mark = `${variant}-${suffix}`;
  const sourceOrderNo = `${variant}-SOURCE-${suffix}`;
  const targetOrderNo = `${variant}-TARGET-${suffix}`;
  const targetInvNo = `${variant}-INV-${suffix}`;
  const receiptNo = `${variant}-RCPT-${suffix}`;
  const amount = options.amount ?? INCIDENT_AMOUNT;
  const targetAmount = options.targetAmount ?? TARGET_AMOUNT;

  await createInvoiceOrder(t, {
    invNo: targetInvNo,
    orderNo: targetOrderNo,
    amount: targetAmount,
    mark,
  });
  const originalReceipt = await createReceipt(t, {
    receiptNo,
    orderNo: sourceOrderNo,
    amount,
    mark,
  });
  const source = await findOrder(t, sourceOrderNo);
  t.assertOk(Boolean(source?.order?.id), `source pool order ${sourceOrderNo} is available`);

  await transferBalance(t, {
    sourceOrderId: source.order.id,
    targetOrderNo,
    amount,
  });
  const generatedReceipt = await findReceipt(
    t,
    targetOrderNo,
    (row) => row.orderNo === targetOrderNo && row.isSystemTransfer === true,
  );
  t.assertOk(Boolean(generatedReceipt?.id), `linked transfer receipt for ${targetOrderNo} is available`);

  return {
    mark,
    amount,
    targetAmount,
    sourceOrderNo,
    sourceOrderId: source.order.id,
    targetOrderNo,
    targetInvNo,
    receiptNo,
    originalReceipt,
    generatedReceipt,
  };
}

function editPatch(fixture) {
  return {
    receiptNo: fixture.receiptNo,
    date: '2026-07-01',
    orderNo: fixture.targetOrderNo,
    invNo: fixture.targetInvNo,
    customerMark: fixture.mark,
    payer: `PAYER ${fixture.mark}`,
    tel: '622000000',
  };
}

async function assertTargetBalance(t, fixture, expected, message) {
  const target = await findOrder(t, fixture.targetOrderNo);
  t.assertOk(Boolean(target?.order), `${message}: target order exists`);
  t.assertEqual(Number(target.order.orderBalance), expected, message);
}

async function assertNoSystemTransferReceipt(t, fixture, message) {
  const generated = await findReceipt(
    t,
    fixture.targetOrderNo,
    (row) => row.id === fixture.generatedReceipt.id || row.isSystemTransfer === true,
  );
  t.assertEqual(generated, null, message);
}

async function assertDirectEditFlow(t, fixture) {
  const detailCreate = await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      date: '2026-07-01',
      items: [{
        mark: fixture.mark,
        orderNo: fixture.sourceOrderNo,
        amount: fixture.amount,
        receiptId: fixture.originalReceipt.id,
      }],
    },
    expectedStatus: 200,
  });
  const detailId = String(detailCreate.data?.data?.id || '');
  t.assertOk(Boolean(detailId), 'original receipt can be linked to a payment detail before correction');

  t.cookies.set('NEXT_LOCALE', 'en');
  const confirmationRequired = await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId: fixture.originalReceipt.id,
      data: editPatch(fixture),
    },
    expectedStatus: 409,
  });
  t.assertEqual(
    confirmationRequired.data?.code,
    'RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED',
    'direct receipt correction requires explicit transfer reversal confirmation',
  );
  t.assertMatch(
    confirmationRequired.data?.error || confirmationRequired.text,
    /Confirm reversal before editing the receipt/,
    'direct receipt correction confirmation is localized in English',
  );
  const transferId = String(confirmationRequired.data?.detail?.balanceTransferId || '');
  t.assertOk(Boolean(transferId), 'confirmation response returns the exact transfer identity');

  const beforeRetry = await findReceipt(
    t,
    fixture.receiptNo,
    (row) => row.id === fixture.originalReceipt.id,
  );
  t.assertEqual(beforeRetry?.orderNo, fixture.sourceOrderNo, 'confirmation-required response performs no partial receipt edit');
  await assertTargetBalance(
    t,
    fixture,
    EXPECTED_TARGET_BALANCE,
    'confirmation-required response performs no partial balance mutation',
  );

  const confirmed = await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId: fixture.originalReceipt.id,
      expectedBalanceTransferId: transferId,
      data: editPatch(fixture),
    },
    expectedStatus: 200,
  });
  t.assertMatch(
    confirmed.data?.message || confirmed.text,
    /Update completed/,
    'confirmed direct correction returns localized English success text',
  );

  const corrected = await findReceipt(
    t,
    fixture.receiptNo,
    (row) => row.id === fixture.originalReceipt.id,
  );
  t.assertEqual(corrected?.orderNo, fixture.targetOrderNo, 'confirmed correction rebinds the real receipt to the target order');
  t.assertEqual(corrected?.invNo, fixture.targetInvNo, 'confirmed correction rebinds the real receipt to the target invoice');
  await assertNoSystemTransferReceipt(t, fixture, 'confirmed correction removes the duplicate system transfer receipt');
  await assertTargetBalance(
    t,
    fixture,
    EXPECTED_TARGET_BALANCE,
    'incident-equivalent target balance is 10,453 after correction',
  );

  const sourceAfter = await findOrder(t, fixture.sourceOrderNo);
  t.assertEqual(sourceAfter, null, 'empty incorrect Un_Associated source order is removed after correction');

  const targetReceipts = (await listReceipts(t, fixture.targetOrderNo))
    .filter((row) => row.orderNo === fixture.targetOrderNo && Number(row.usd) === fixture.amount);
  t.assertEqual(targetReceipts.length, 1, 'target order contains exactly one 3,213 payment after correction');
  t.assertEqual(targetReceipts[0]?.id, fixture.originalReceipt.id, 'the one remaining target payment is the original real receipt');

  const details = await t.request(
    'GET',
    `/api/detail?search=${encodeURIComponent(fixture.targetOrderNo)}`,
    { expectedStatus: 200 },
  );
  const detail = detailRows(details).find((row) => row.id === detailId);
  const linkedItem = (Array.isArray(detail?.items) ? detail.items : [])
    .find((item) => item.receiptId === fixture.originalReceipt.id);
  t.assertEqual(linkedItem?.orderNo, fixture.targetOrderNo, 'existing payment detail linkage follows the corrected receipt order');

  const staleRetry = await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId: fixture.originalReceipt.id,
      expectedBalanceTransferId: transferId,
      data: editPatch(fixture),
    },
    expectedStatus: 409,
  });
  t.assertEqual(staleRetry.data?.code, 'CONFLICT', 'a stale confirmed retry is blocked without a second mutation');
  await assertTargetBalance(t, fixture, EXPECTED_TARGET_BALANCE, 'stale retry leaves the corrected balance unchanged');
  t.cookies.set('NEXT_LOCALE', 'zh');
}

async function assertApprovalFlow(t, fixture, branchAdminEmail, salesEmail) {
  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');
  t.cookies.set('NEXT_LOCALE', 'en');
  const requestCreate = await t.request('POST', '/api/receipt', {
    json: {
      action: 'request-edit',
      receiptId: fixture.originalReceipt.id,
      data: editPatch(fixture),
    },
    expectedStatus: 200,
  });
  const requestId = String(requestCreate.data?.data?.id || '');
  t.assertOk(Boolean(requestId), 'sales receipt correction creates one approval request');
  t.assertMatch(
    requestCreate.data?.message || requestCreate.text,
    /Receipt edit request submitted/,
    'sales receipt edit submission returns localized English text',
  );
  t.cookies.set('NEXT_LOCALE', 'zh');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');
  const confirmationRequired = await t.request('POST', '/api/receipt', {
    json: {
      action: 'review-edit',
      requestId,
      decision: 'approve',
      comment: 'confirm transfer reversal',
    },
    expectedStatus: 409,
  });
  t.assertEqual(
    confirmationRequired.data?.code,
    'RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED',
    'admin approval requires explicit transfer reversal confirmation',
  );
  const transferId = String(confirmationRequired.data?.detail?.balanceTransferId || '');
  t.assertOk(Boolean(transferId), 'approval confirmation returns the exact transfer identity');

  const pendingList = await t.request('POST', '/api/receipt', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const pending = (Array.isArray(pendingList.data?.data) ? pendingList.data.data : [])
    .find((row) => row.id === requestId);
  t.assertEqual(pending?.status, 'PENDING', 'confirmation-required approval remains pending');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'review-edit',
      requestId,
      decision: 'approve',
      comment: 'confirmed transfer reversal',
      expectedBalanceTransferId: transferId,
    },
    expectedStatus: 200,
  });

  const approvedList = await t.request('POST', '/api/receipt', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const approved = (Array.isArray(approvedList.data?.data) ? approvedList.data.data : [])
    .find((row) => row.id === requestId);
  t.assertEqual(approved?.status, 'APPROVED', 'confirmed approval is committed exactly once');

  const corrected = await findReceipt(
    t,
    fixture.receiptNo,
    (row) => row.id === fixture.originalReceipt.id,
  );
  t.assertEqual(corrected?.orderNo, fixture.targetOrderNo, 'approved sales correction moves the real receipt to the target order');
  await assertNoSystemTransferReceipt(t, fixture, 'approved sales correction removes the duplicate transfer receipt');
  await assertTargetBalance(t, fixture, EXPECTED_TARGET_BALANCE, 'approved sales correction produces the correct live balance');
  t.assertEqual(await findOrder(t, fixture.sourceOrderNo), null, 'approved sales correction removes the empty incorrect source order');
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('transfer-reversal');
  const branchAdminEmail = `${suffix}-admin@example.com`;
  const salesEmail = `${suffix}-sales@example.com`;
  const userEmail = `${suffix}-user@example.com`;

  const branchAdmin = await t.createUser({
    email: branchAdminEmail,
    password: 'BranchAdmin@2026!',
    role: 'ADMIN',
    name: `Branch Admin ${suffix}`,
  });
  const branchAdminId = String(branchAdmin.data?.data?.id || '');
  t.assertOk(Boolean(branchAdminId), 'branch admin is available for transfer-aware receipt approvals');

  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sales ${suffix}`,
    parentId: branchAdminId,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'sales account is available for transfer-aware receipt approvals');

  const user = await t.createUser({
    email: userEmail,
    password: 'User@2026!',
    role: 'USER',
    name: `User ${suffix}`,
    parentId: salesId,
  });
  t.assertOk(Boolean(user.data?.data?.id), 'user account is available for reversal permission checks');

  const dedicated = await createTransferFixture(t, suffix, 'DEDICATED');
  await assertTargetBalance(t, dedicated, EXPECTED_TARGET_BALANCE, 'linked transfer initially reduces the target balance once');
  const sourceAfterTransfer = await findOrder(t, dedicated.sourceOrderNo);
  t.assertEqual(Number(sourceAfterTransfer?.order?.amount), INCIDENT_AMOUNT, 'transfer temporarily increases the source accounting amount');
  t.assertEqual(Number(sourceAfterTransfer?.order?.orderBalance), 0, 'transfer temporarily settles the source pool order');

  const ordinaryReverse = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: dedicated.originalReceipt.id },
    expectedStatus: 409,
  });
  t.assertEqual(
    ordinaryReverse.data?.code,
    'BALANCE_TRANSFER_REVERSAL_CONFLICT',
    'an ordinary unlinked receipt cannot invoke transfer reversal',
  );

  await t.logout();
  await t.login(userEmail, 'User@2026!');
  const userDenied = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: dedicated.generatedReceipt.id },
    expectedStatus: 403,
  });
  t.assertEqual(userDenied.data?.code, 'FORBIDDEN', 'user cannot reverse a balance transfer');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');
  const salesDenied = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: dedicated.generatedReceipt.id },
    expectedStatus: 403,
  });
  t.assertEqual(salesDenied.data?.code, 'FORBIDDEN', 'sales cannot reverse a balance transfer');

  await t.logout();
  await t.loginAdmin();
  const reversed = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: dedicated.generatedReceipt.id },
    expectedStatus: 200,
  });
  t.assertEqual(reversed.data?.data?.alreadyReversed, false, 'admin reverses one linked transfer immediately');
  await assertNoSystemTransferReceipt(t, dedicated, 'dedicated reversal removes the generated transfer receipt');
  await assertTargetBalance(t, dedicated, TARGET_AMOUNT, 'dedicated reversal restores the target balance');
  const sourceAfterDedicatedReversal = await findOrder(t, dedicated.sourceOrderNo);
  t.assertEqual(Number(sourceAfterDedicatedReversal?.order?.amount), 0, 'dedicated reversal restores the source amount');
  t.assertEqual(Number(sourceAfterDedicatedReversal?.order?.orderBalance), -INCIDENT_AMOUNT, 'source retains the real overpayment after dedicated reversal');

  const repeated = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: dedicated.generatedReceipt.id },
    expectedStatus: 200,
  });
  t.assertEqual(repeated.data?.data?.alreadyReversed, true, 'repeating the same reversal is idempotent');
  await assertTargetBalance(t, dedicated, TARGET_AMOUNT, 'idempotent reversal does not change balances twice');

  const direct = await createTransferFixture(t, suffix, 'DIRECT');
  await assertDirectEditFlow(t, direct);

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');
  const approvalMark = `APPROVAL-${suffix}`;
  const approvalTargetOrderNo = `APPROVAL-TARGET-${suffix}`;
  const approvalTargetInvNo = `APPROVAL-INV-${suffix}`;
  const customerCreate = await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: approvalMark,
      orderName: `APPROVAL-TARGET-${suffix}`,
      name: `Approval Customer ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(customerCreate.data?.data?.id), 'sales-owned customer is available for approval visibility');
  await createInvoiceOrder(t, {
    invNo: approvalTargetInvNo,
    orderNo: approvalTargetOrderNo,
    amount: TARGET_AMOUNT,
    mark: approvalMark,
  });

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');
  const approvalSourceOrderNo = `APPROVAL-SOURCE-${suffix}`;
  const approvalReceiptNo = `APPROVAL-RCPT-${suffix}`;
  const approvalOriginal = await createReceipt(t, {
    receiptNo: approvalReceiptNo,
    orderNo: approvalSourceOrderNo,
    amount: INCIDENT_AMOUNT,
    mark: approvalMark,
  });
  const approvalSource = await findOrder(t, approvalSourceOrderNo);
  t.assertOk(Boolean(approvalSource?.order?.id), 'sales source pool order is visible before approval flow');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');
  await transferBalance(t, {
    sourceOrderId: approvalSource.order.id,
    targetOrderNo: approvalTargetOrderNo,
    amount: INCIDENT_AMOUNT,
  });
  const approvalGenerated = await findReceipt(
    t,
    approvalTargetOrderNo,
    (row) => row.orderNo === approvalTargetOrderNo && row.isSystemTransfer === true,
  );
  t.assertOk(Boolean(approvalGenerated?.id), 'approval fixture has one linked transfer receipt');
  const approvalFixture = {
    mark: approvalMark,
    amount: INCIDENT_AMOUNT,
    targetAmount: TARGET_AMOUNT,
    sourceOrderNo: approvalSourceOrderNo,
    sourceOrderId: approvalSource.order.id,
    targetOrderNo: approvalTargetOrderNo,
    targetInvNo: approvalTargetInvNo,
    receiptNo: approvalReceiptNo,
    originalReceipt: approvalOriginal,
    generatedReceipt: approvalGenerated,
  };
  await assertApprovalFlow(t, approvalFixture, branchAdminEmail, salesEmail);

  await t.logout();
  await t.loginAdmin();
  const ambiguous = await createTransferFixture(t, suffix, 'AMBIGUOUS', { targetAmount: 20000 });
  const secondOriginal = await createReceipt(t, {
    receiptNo: `AMBIGUOUS-RCPT-2-${suffix}`,
    orderNo: ambiguous.sourceOrderNo,
    amount: INCIDENT_AMOUNT,
    mark: ambiguous.mark,
  });
  t.assertOk(Boolean(secondOriginal.id), 'second real receipt creates enough overpayment for an ambiguous transfer fixture');
  await transferBalance(t, {
    sourceOrderId: ambiguous.sourceOrderId,
    targetOrderNo: ambiguous.targetOrderNo,
    amount: INCIDENT_AMOUNT,
  });
  const ambiguousGenerated = (await listReceipts(t, ambiguous.targetOrderNo))
    .filter((row) => row.orderNo === ambiguous.targetOrderNo && row.isSystemTransfer === true);
  t.assertEqual(ambiguousGenerated.length, 2, 'ambiguous fixture contains two equally valid transfer relations');

  const ambiguityBlocked = await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId: ambiguous.originalReceipt.id,
      data: editPatch(ambiguous),
    },
    expectedStatus: 409,
  });
  t.assertEqual(
    ambiguityBlocked.data?.code,
    'BALANCE_TRANSFER_REVERSAL_CONFLICT',
    'ambiguous receipt correction is blocked instead of guessing a transfer',
  );
  const ambiguousOriginalAfter = await findReceipt(
    t,
    ambiguous.receiptNo,
    (row) => row.id === ambiguous.originalReceipt.id,
  );
  t.assertEqual(ambiguousOriginalAfter?.orderNo, ambiguous.sourceOrderNo, 'ambiguous correction leaves the original receipt unchanged');
  t.assertEqual(
    (await listReceipts(t, ambiguous.targetOrderNo)).filter((row) => row.isSystemTransfer === true).length,
    2,
    'ambiguous correction leaves both transfer receipts unchanged',
  );

  const protectedFixture = await createTransferFixture(t, suffix, 'PROTECTED');
  const agentCreate = await t.request('POST', '/api/agent', {
    json: {
      action: 'create',
      companyName: `Protected Agent ${suffix}`,
      companyAddress: 'Conakry',
      contactName: 'Agent Contact',
      contactPhone: '622111111',
    },
    expectedStatus: 200,
  });
  const agentId = String(agentCreate.data?.data?.id || '');
  t.assertOk(Boolean(agentId), 'payment agent is available for protected transfer linkage');
  await t.request('POST', '/api/detail', {
    json: {
      action: 'confirm',
      date: '2026-07-02',
      agentId,
      items: [{
        mark: protectedFixture.mark,
        orderNo: protectedFixture.targetOrderNo,
        amount: protectedFixture.amount,
        receiptId: protectedFixture.generatedReceipt.id,
      }],
    },
    expectedStatus: 200,
  });
  t.step('generated transfer receipt is linked to a payment detail');

  const protectedReverse = await t.request('POST', '/api/receipt', {
    json: { action: 'reverse-transfer', receiptId: protectedFixture.generatedReceipt.id },
    expectedStatus: 409,
  });
  t.assertEqual(
    protectedReverse.data?.code,
    'BALANCE_TRANSFER_REVERSAL_CONFLICT',
    'a transfer receipt referenced by a payment detail cannot be reversed',
  );
  const protectedReceiptAfter = await findReceipt(
    t,
    protectedFixture.targetOrderNo,
    (row) => row.id === protectedFixture.generatedReceipt.id,
  );
  t.assertOk(Boolean(protectedReceiptAfter), 'failed protected reversal keeps the generated receipt');
  await assertTargetBalance(
    t,
    protectedFixture,
    EXPECTED_TARGET_BALANCE,
    'failed protected reversal rolls back all accounting changes',
  );
  const protectedSourceAfter = await findOrder(t, protectedFixture.sourceOrderNo);
  t.assertEqual(Number(protectedSourceAfter?.order?.amount), INCIDENT_AMOUNT, 'failed protected reversal keeps the source amount unchanged');

  await t.logout();
}
