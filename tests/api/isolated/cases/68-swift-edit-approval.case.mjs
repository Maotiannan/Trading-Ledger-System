export const name = 'swift-edit-approval';

function normalizeAccount(value) {
  return String(value || '')
    .replace(/[oO]/g, '0')
    .replace(/[^0-9]/g, '');
}

function editablePatch(suffix, variant, amount) {
  return {
    date: '2026-05-05',
    amount,
    senderName: `SENDER-${variant}-${suffix}`,
    senderAddress: `ADDR-${variant}-${suffix}`,
    receiverName: `RECEIVER-${variant}-${suffix}`,
    receiverAccount: `ACCOUNT-${variant}-${suffix}`,
  };
}

async function createDetail(t, payload) {
  return t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      date: payload.date,
      items: payload.items,
    },
    expectedStatus: 200,
  });
}

async function createSwift(t, payload) {
  return t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: payload.detailId,
      amount: payload.amount,
      date: payload.date,
      senderName: payload.senderName,
      senderAddress: payload.senderAddress,
      receiverName: payload.receiverName,
      receiverAccount: payload.receiverAccount,
    },
    expectedStatus: 200,
  });
}

async function fetchSwiftById(t, swiftId) {
  const response = await t.request('GET', '/api/swift', { expectedStatus: 200 });
  return (Array.isArray(response.data?.data) ? response.data.data : []).find((row) => row.id === swiftId);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('swift-edit');
  const branchAdminEmail = `${suffix}-admin@example.com`;
  const salesEmail = `${suffix}-sales@example.com`;

  const branchAdmin = await t.createUser({
    email: branchAdminEmail,
    password: 'BranchAdmin@2026!',
    role: 'ADMIN',
    name: `Branch Admin ${suffix}`,
  });
  const branchAdminId = String(branchAdmin.data?.data?.id || '');
  t.assertOk(Boolean(branchAdminId), 'root admin can create branch admin for swift edit approval');

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

  const salesDetailCreate = await createDetail(t, {
    date: '2026-05-01',
    items: [{ mark: `REQ-${suffix}`, orderNo: `REQ-${suffix}-01`, amount: 120 }],
  });
  const salesDetailId = String(salesDetailCreate.data?.data?.id || '');
  t.assertOk(Boolean(salesDetailId), 'sales can create detail for swift approval flow');

  const salesSwiftCreate = await createSwift(t, {
    detailId: salesDetailId,
    amount: 120,
    date: '2026-05-02',
    senderName: `OLD-SENDER-${suffix}`,
    senderAddress: 'Conakry',
    receiverName: `OLD-RECEIVER-${suffix}`,
    receiverAccount: 'ACC-OLD',
  });
  const salesSwiftId = String(salesSwiftCreate.data?.data?.swift?.id || '');
  t.assertOk(Boolean(salesSwiftId), 'sales can direct-create swift for approval flow');

  const requestedPatch = editablePatch(suffix, 'REQ', 120);
  const requestCreate = await t.request('POST', '/api/swift', {
    json: {
      action: 'request-edit',
      swiftId: salesSwiftId,
      data: requestedPatch,
    },
    expectedStatus: 200,
  });
  const requestId = String(requestCreate.data?.data?.id || '');
  t.assertOk(Boolean(requestId), 'sales swift request-edit succeeds');
  t.assertMatch(requestCreate.data?.message || requestCreate.text, /等待管理员同意/, 'sales swift request-edit returns pending approval message');

  const duplicatePending = await t.request('POST', '/api/swift', {
    json: {
      action: 'request-edit',
      swiftId: salesSwiftId,
      data: editablePatch(suffix, 'DUP', 120),
    },
    expectedStatus: 409,
  });
  t.assertMatch(duplicatePending.data?.error || duplicatePending.text, /待审批的修改申请/, 'duplicate pending swift request is blocked');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');

  const requestList = await t.request('POST', '/api/swift', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const requestRows = Array.isArray(requestList.data?.data) ? requestList.data.data : [];
  const pendingRow = requestRows.find((row) => row.id === requestId);
  t.assertOk(Boolean(pendingRow), 'higher visible admin can list descendant pending swift edit request');
  t.assertEqual(pendingRow?.requestedBy, salesId, 'swift pending request keeps requester id');
  t.assertEqual(pendingRow?.status, 'PENDING', 'swift pending request is listed as pending');
  t.assertEqual(pendingRow?.afterSnapshot?.senderName, requestedPatch.senderName, 'swift pending request keeps requested sender snapshot');

  const approveResponse = await t.request('POST', '/api/swift', {
    json: {
      action: 'review-edit',
      requestId,
      decision: 'approve',
      comment: 'approved by branch admin',
    },
    expectedStatus: 200,
  });
  t.assertMatch(approveResponse.data?.message || approveResponse.text, /已通过/, 'higher visible admin can approve pending swift edit request');

  const approvedSwift = await fetchSwiftById(t, salesSwiftId);
  t.assertEqual(approvedSwift?.date ? String(approvedSwift.date).slice(0, 10) : null, requestedPatch.date, 'approved swift edit updates date');
  t.assertEqual(Number(approvedSwift?.amount || 0), requestedPatch.amount, 'approved swift edit updates amount');
  t.assertEqual(approvedSwift?.senderName, requestedPatch.senderName, 'approved swift edit updates sender name');
  t.assertEqual(approvedSwift?.senderAddress, requestedPatch.senderAddress, 'approved swift edit updates sender address');
  t.assertEqual(approvedSwift?.receiverName, requestedPatch.receiverName, 'approved swift edit updates receiver name');
  t.assertEqual(approvedSwift?.receiverAccount, normalizeAccount(requestedPatch.receiverAccount), 'approved swift edit updates receiver account');

  const requestListAfterApproval = await t.request('POST', '/api/swift', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const approvedRows = Array.isArray(requestListAfterApproval.data?.data) ? requestListAfterApproval.data.data : [];
  const approvedRow = approvedRows.find((row) => row.id === requestId);
  t.assertEqual(approvedRow?.status, 'APPROVED', 'approved swift edit request is listed as approved after review');

  const adminDetailCreate = await createDetail(t, {
    date: '2026-05-03',
    items: [{ mark: `ADMIN-${suffix}`, orderNo: `ADMIN-${suffix}-01`, amount: 135 }],
  });
  const adminDetailId = String(adminDetailCreate.data?.data?.id || '');
  t.assertOk(Boolean(adminDetailId), 'admin can create detail for direct swift update path');

  const adminSwiftCreate = await createSwift(t, {
    detailId: adminDetailId,
    amount: 135,
    date: '2026-05-03',
    senderName: `ADMIN-OLD-SENDER-${suffix}`,
    senderAddress: 'Kindia',
    receiverName: `ADMIN-OLD-RECEIVER-${suffix}`,
    receiverAccount: 'ACC-ADMIN-OLD',
  });
  const adminSwiftId = String(adminSwiftCreate.data?.data?.swift?.id || '');
  t.assertOk(Boolean(adminSwiftId), 'admin can create swift for direct update path');

  const adminPatch = editablePatch(suffix, 'ADMIN', 135);
  const directUpdate = await t.request('POST', '/api/swift', {
    json: {
      action: 'update',
      swiftId: adminSwiftId,
      data: adminPatch,
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(directUpdate.data?.success), true, 'direct admin swift update path succeeds immediately');

  const updatedAdminSwift = await fetchSwiftById(t, adminSwiftId);
  t.assertEqual(updatedAdminSwift?.date ? String(updatedAdminSwift.date).slice(0, 10) : null, adminPatch.date, 'direct admin swift update changes date immediately');
  t.assertEqual(Number(updatedAdminSwift?.amount || 0), adminPatch.amount, 'direct admin swift update changes amount immediately');
  t.assertEqual(updatedAdminSwift?.senderName, adminPatch.senderName, 'direct admin swift update changes sender name immediately');
  t.assertEqual(updatedAdminSwift?.senderAddress, adminPatch.senderAddress, 'direct admin swift update changes sender address immediately');
  t.assertEqual(updatedAdminSwift?.receiverName, adminPatch.receiverName, 'direct admin swift update changes receiver name immediately');
  t.assertEqual(updatedAdminSwift?.receiverAccount, normalizeAccount(adminPatch.receiverAccount), 'direct admin swift update changes receiver account immediately');

  const finalRequestList = await t.request('POST', '/api/swift', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const finalRows = Array.isArray(finalRequestList.data?.data) ? finalRequestList.data.data : [];
  t.assertOk(!finalRows.some((row) => row.swiftId === adminSwiftId), 'direct admin swift update does not create approval request rows');

  await t.logout();
}
