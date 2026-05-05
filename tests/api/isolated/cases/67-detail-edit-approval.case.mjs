export const name = 'detail-edit-approval';

function editablePatch(suffix, variant) {
  return {
    date: '2026-05-05',
    items: [
      {
        mark: `MARK-${variant}-${suffix}`,
        orderNo: `ORDER-${variant}-${suffix}`,
        amount: 120,
        receiptId: null,
      },
    ],
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

async function fetchDetailById(t, detailId) {
  const response = await t.request('GET', '/api/detail', { expectedStatus: 200 });
  return (Array.isArray(response.data?.data) ? response.data.data : []).find((row) => row.id === detailId);
}

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('detail-edit');
  const branchAdminEmail = `${suffix}-admin@example.com`;
  const salesEmail = `${suffix}-sales@example.com`;

  const branchAdmin = await t.createUser({
    email: branchAdminEmail,
    password: 'BranchAdmin@2026!',
    role: 'ADMIN',
    name: `Branch Admin ${suffix}`,
  });
  const branchAdminId = String(branchAdmin.data?.data?.id || '');
  t.assertOk(Boolean(branchAdminId), 'root admin can create branch admin for detail edit approval');

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
  t.assertOk(Boolean(salesDetailId), 'sales can direct-create detail for approval flow');

  const requestedPatch = editablePatch(suffix, 'REQ');
  const requestCreate = await t.request('POST', '/api/detail', {
    json: {
      action: 'request-edit',
      detailId: salesDetailId,
      data: requestedPatch,
    },
    expectedStatus: 200,
  });
  const requestId = String(requestCreate.data?.data?.id || '');
  t.assertOk(Boolean(requestId), 'sales detail request-edit succeeds');
  t.assertMatch(requestCreate.data?.message || requestCreate.text, /等待管理员同意/, 'sales detail request-edit returns pending approval message');

  const duplicatePending = await t.request('POST', '/api/detail', {
    json: {
      action: 'request-edit',
      detailId: salesDetailId,
      data: editablePatch(suffix, 'DUP'),
    },
    expectedStatus: 409,
  });
  t.assertMatch(duplicatePending.data?.error || duplicatePending.text, /待审批的修改申请/, 'duplicate pending detail request is blocked');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');

  const requestList = await t.request('POST', '/api/detail', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const requestRows = Array.isArray(requestList.data?.data) ? requestList.data.data : [];
  const pendingRow = requestRows.find((row) => row.id === requestId);
  t.assertOk(Boolean(pendingRow), 'higher visible admin can list descendant pending detail edit request');
  t.assertEqual(pendingRow?.requestedBy, salesId, 'detail pending request keeps requester id');
  t.assertEqual(pendingRow?.status, 'PENDING', 'detail pending request is listed as pending');
  t.assertEqual(pendingRow?.afterSnapshot?.items?.[0]?.orderNo, requestedPatch.items[0].orderNo, 'detail pending request keeps requested item snapshot');

  const approveResponse = await t.request('POST', '/api/detail', {
    json: {
      action: 'review-edit',
      requestId,
      decision: 'approve',
      comment: 'approved by branch admin',
    },
    expectedStatus: 200,
  });
  t.assertMatch(approveResponse.data?.message || approveResponse.text, /已通过/, 'higher visible admin can approve pending detail edit request');

  const approvedDetail = await fetchDetailById(t, salesDetailId);
  t.assertEqual(approvedDetail?.date ? String(approvedDetail.date).slice(0, 10) : null, requestedPatch.date, 'approved detail edit updates date');
  t.assertEqual(approvedDetail?.items?.[0]?.mark, requestedPatch.items[0].mark, 'approved detail edit updates item mark');
  t.assertEqual(approvedDetail?.items?.[0]?.orderNo, requestedPatch.items[0].orderNo, 'approved detail edit updates item orderNo');
  t.assertEqual(Number(approvedDetail?.items?.[0]?.amount || 0), requestedPatch.items[0].amount, 'approved detail edit updates item amount');

  const requestListAfterApproval = await t.request('POST', '/api/detail', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const approvedRows = Array.isArray(requestListAfterApproval.data?.data) ? requestListAfterApproval.data.data : [];
  const approvedRow = approvedRows.find((row) => row.id === requestId);
  t.assertEqual(approvedRow?.status, 'APPROVED', 'approved detail edit request is listed as approved after review');

  const adminDetailCreate = await createDetail(t, {
    date: '2026-05-03',
    items: [{ mark: `ADMIN-${suffix}`, orderNo: `ADMIN-${suffix}-01`, amount: 135 }],
  });
  const adminDetailId = String(adminDetailCreate.data?.data?.id || '');
  t.assertOk(Boolean(adminDetailId), 'admin can direct-create detail for direct update path');

  const adminPatch = editablePatch(suffix, 'ADMIN');
  const directUpdate = await t.request('POST', '/api/detail', {
    json: {
      action: 'update',
      detailId: adminDetailId,
      data: adminPatch,
    },
    expectedStatus: 200,
  });
  t.assertEqual(Boolean(directUpdate.data?.success), true, 'direct admin detail update path succeeds immediately');

  const updatedAdminDetail = await fetchDetailById(t, adminDetailId);
  t.assertEqual(updatedAdminDetail?.date ? String(updatedAdminDetail.date).slice(0, 10) : null, adminPatch.date, 'direct admin detail update changes date immediately');
  t.assertEqual(updatedAdminDetail?.items?.[0]?.mark, adminPatch.items[0].mark, 'direct admin detail update changes item mark immediately');
  t.assertEqual(updatedAdminDetail?.items?.[0]?.orderNo, adminPatch.items[0].orderNo, 'direct admin detail update changes item orderNo immediately');
  t.assertEqual(Number(updatedAdminDetail?.items?.[0]?.amount || 0), adminPatch.items[0].amount, 'direct admin detail update changes item amount immediately');

  const finalRequestList = await t.request('POST', '/api/detail', {
    json: { action: 'list-edit-requests' },
    expectedStatus: 200,
  });
  const finalRows = Array.isArray(finalRequestList.data?.data) ? finalRequestList.data.data : [];
  t.assertOk(!finalRows.some((row) => row.detailId === adminDetailId), 'direct admin detail update does not create approval request rows');

  await t.logout();
}
