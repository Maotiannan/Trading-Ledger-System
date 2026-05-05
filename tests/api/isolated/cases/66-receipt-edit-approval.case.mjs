export const name = 'receipt-edit-approval';

function findReceiptByOrder(rows, orderNo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.orderNo === orderNo);
}

function editablePatch(suffix, variant) {
  return {
    receiptNo: `EDIT-${variant}-${suffix}`,
    date: '2026-05-05',
    invNo: `INV-${variant}-${suffix}`,
    customerMark: `MARK-${variant}-${suffix}`,
    payer: `PAYER-${variant}-${suffix}`,
    tel: `100-${String(variant).slice(0, 3)}`,
  };
}

async function createReceipt(t, params) {
  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: params.receiptNo,
      usd: params.usd,
      orderNo: params.orderNo,
      customerMark: params.customerMark,
      customerName: params.customerName,
      invNo: params.invNo,
      payer: params.payer,
      tel: params.tel,
      date: params.date,
    },
    expectedStatus: 200,
  });
}

async function fetchReceiptByOrder(t, orderNo) {
  const response = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  return findReceiptByOrder(response.data?.data, orderNo);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('receipt-edit');
  const branchAdminEmail = `${suffix}-admin@example.com`;
  const salesEmail = `${suffix}-sales@example.com`;

  const branchAdmin = await t.createUser({
    email: branchAdminEmail,
    password: 'BranchAdmin@2026!',
    role: 'ADMIN',
    name: `Branch Admin ${suffix}`,
  });
  const branchAdminId = String(branchAdmin.data?.data?.id || '');
  t.assertOk(Boolean(branchAdminId), 'root admin can create branch admin for receipt edit approval');

  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sales ${suffix}`,
    parentId: branchAdminId,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'root admin can create sales under branch admin');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  const requestOrderNo = `EDIT-REQ-${suffix}`;
  await createReceipt(t, {
    receiptNo: `REQ-${suffix}`,
    usd: 210,
    orderNo: requestOrderNo,
    customerMark: `REQ-${suffix}`,
    customerName: `REQ-${suffix}`,
    invNo: `REQ-INV-${suffix}`,
    payer: `REQ-PAYER-${suffix}`,
    tel: '100-REQ',
    date: '2026-05-01',
  });
  t.step('sales can direct-create receipt for edit approval flow');

  const requestReceipt = await fetchReceiptByOrder(t, requestOrderNo);
  t.assertOk(Boolean(requestReceipt?.id), 'sales receipt is queryable before edit request');

  const requestedPatch = editablePatch(suffix, 'REQ');
  const requestCreate = await t.request('POST', '/api/receipt', {
    json: {
      action: 'request-edit',
      receiptId: requestReceipt.id,
      data: requestedPatch,
    },
    expectedStatus: 200,
  });
  const requestId = String(requestCreate.data?.data?.id || '');
  t.assertOk(Boolean(requestId), 'sales request-edit succeeds and returns request id');
  t.assertMatch(requestCreate.data?.message || requestCreate.text, /等待管理员同意/, 'sales request-edit returns pending approval message');

  const duplicatePending = await t.request('POST', '/api/receipt', {
    json: {
      action: 'request-edit',
      receiptId: requestReceipt.id,
      data: editablePatch(suffix, 'DUP'),
    },
    expectedStatus: 409,
  });
  t.assertMatch(duplicatePending.data?.error || duplicatePending.text, /待审批的修改申请/, 'duplicate pending request is blocked');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');

  const requestList = await t.request('POST', '/api/receipt', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const requestRows = Array.isArray(requestList.data?.data) ? requestList.data.data : [];
  const pendingRow = requestRows.find((row) => row.id === requestId);
  t.assertOk(Boolean(pendingRow), 'higher visible admin can list descendant pending edit request');
  t.assertEqual(pendingRow?.requestedBy, salesId, 'pending edit request keeps requester id');
  t.assertEqual(pendingRow?.status, 'PENDING', 'pending edit request is listed as pending');
  t.assertEqual(pendingRow?.afterSnapshot?.receiptNo, requestedPatch.receiptNo, 'pending edit request keeps requested receiptNo snapshot');

  const approveResponse = await t.request('POST', '/api/receipt', {
    json: {
      action: 'review-edit',
      requestId,
      decision: 'approve',
      comment: 'approved by branch admin',
    },
    expectedStatus: 200,
  });
  t.assertMatch(approveResponse.data?.message || approveResponse.text, /已通过/, 'higher visible admin can approve pending edit request');

  const approvedReceipt = await fetchReceiptByOrder(t, requestOrderNo);
  t.assertEqual(approvedReceipt?.receiptNo, requestedPatch.receiptNo, 'approved edit updates receiptNo');
  t.assertEqual(approvedReceipt?.date ? String(approvedReceipt.date).slice(0, 10) : null, requestedPatch.date, 'approved edit updates date');
  t.assertEqual(approvedReceipt?.invNo, requestedPatch.invNo, 'approved edit updates invNo');
  t.assertEqual(approvedReceipt?.customerMark, requestedPatch.customerMark, 'approved edit updates customerMark');
  t.assertEqual(approvedReceipt?.payer, requestedPatch.payer, 'approved edit updates payer');
  t.assertEqual(approvedReceipt?.tel, requestedPatch.tel, 'approved edit updates tel');

  const requestListAfterApproval = await t.request('POST', '/api/receipt', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const approvedRows = Array.isArray(requestListAfterApproval.data?.data) ? requestListAfterApproval.data.data : [];
  const approvedRow = approvedRows.find((row) => row.id === requestId);
  t.assertEqual(approvedRow?.status, 'APPROVED', 'approved edit request is listed as approved after review');

  const adminOrderNo = `EDIT-ADMIN-${suffix}`;
  await createReceipt(t, {
    receiptNo: `ADMIN-${suffix}`,
    usd: 320,
    orderNo: adminOrderNo,
    customerMark: `ADMIN-${suffix}`,
    customerName: `ADMIN-${suffix}`,
    invNo: `ADMIN-INV-${suffix}`,
    payer: `ADMIN-PAYER-${suffix}`,
    tel: '100-ADM',
    date: '2026-05-03',
  });
  t.step('admin can direct-create receipt for direct update path');

  const adminReceipt = await fetchReceiptByOrder(t, adminOrderNo);
  t.assertOk(Boolean(adminReceipt?.id), 'admin receipt is queryable before direct update');

  const adminPatch = editablePatch(suffix, 'ADMIN');
  const directUpdate = await t.request('POST', '/api/receipt', {
    json: {
      action: 'update',
      receiptId: adminReceipt.id,
      data: adminPatch,
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(directUpdate.data?.success), true, 'direct admin update path succeeds immediately');

  const updatedAdminReceipt = await fetchReceiptByOrder(t, adminOrderNo);
  t.assertEqual(updatedAdminReceipt?.receiptNo, adminPatch.receiptNo, 'direct admin update changes receiptNo immediately');
  t.assertEqual(updatedAdminReceipt?.date ? String(updatedAdminReceipt.date).slice(0, 10) : null, adminPatch.date, 'direct admin update changes date immediately');
  t.assertEqual(updatedAdminReceipt?.invNo, adminPatch.invNo, 'direct admin update changes invNo immediately');
  t.assertEqual(updatedAdminReceipt?.customerMark, adminPatch.customerMark, 'direct admin update changes customerMark immediately');
  t.assertEqual(updatedAdminReceipt?.payer, adminPatch.payer, 'direct admin update changes payer immediately');
  t.assertEqual(updatedAdminReceipt?.tel, adminPatch.tel, 'direct admin update changes tel immediately');

  const finalRequestList = await t.request('POST', '/api/receipt', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const finalRows = Array.isArray(finalRequestList.data?.data) ? finalRequestList.data.data : [];
  t.assertOk(!finalRows.some((row) => row.receiptId === adminReceipt.id), 'direct admin update does not create approval request rows');

  await t.logout();
}
