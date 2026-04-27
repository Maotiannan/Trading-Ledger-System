export const name = 'invoice-ledger-flow';

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('invoice');
  const mark = `MAB-${suffix}`;
  const orderNo = `${mark}-01`;
  const secondaryOrderNo = `ALT-${suffix}-01`;
  const updatedSecondaryOrderNo = `ALT-${suffix}-02`;
  const invoiceNo = `INV-${suffix}`;
  const branchAdminEmail = `${suffix}-branch-admin@example.com`;
  const salesEmail = `${suffix}-sales@example.com`;

  const branchAdmin = await t.createUser({
    email: branchAdminEmail,
    password: 'BranchAdmin@2026!',
    role: 'ADMIN',
    name: `Branch Admin ${suffix}`,
  });
  const branchAdminId = String(branchAdmin.data?.data?.id || '');
  t.assertOk(Boolean(branchAdminId), 'branch admin created for invoice reassignment');

  const sales = await t.createUser({
    email: salesEmail,
    password: 'Sales@2026!',
    role: 'SALES',
    name: `Sales ${suffix}`,
    parentId: branchAdminId,
  });
  const salesId = String(sales.data?.data?.id || '');
  t.assertOk(Boolean(salesId), 'sales created under branch admin');

  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Customer ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.step('invoice test customer created');

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: invoiceNo,
      shipDate: '2026-03-10',
      releaseDate: '2026-03-11',
      orders: [
        { orderNo, amount: 1200, customerMark: mark, customerName: mark },
      ],
    },
    expectedStatus: 200,
  });
  t.step('invoice created with first order');

  const invoiceList = await t.request('GET', `/api/invoice?search=${encodeURIComponent(invoiceNo)}`, { expectedStatus: 200 });
  const invoiceRow = Array.isArray(invoiceList.data?.data) ? invoiceList.data.data.find((row) => row.invNo === invoiceNo) : null;
  t.assertOk(Boolean(invoiceRow?.id), 'created invoice appears in invoice list');
  const invoiceId = invoiceRow.id;
  const primaryOrder = Array.isArray(invoiceRow.orders) ? invoiceRow.orders.find((row) => row.orderNo === orderNo) : null;
  t.assertOk(Boolean(primaryOrder?.id), 'created order appears in invoice list');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateInvoiceDates',
      invoiceId,
      shipDate: '2026-03-15',
      releaseDate: '2026-03-16',
    },
    expectedStatus: 200,
  });
  t.step('invoice dates updated');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'addOrder',
      invoiceId,
      orderNo: secondaryOrderNo,
      amount: 300,
      customerMark: mark,
      customerName: mark,
    },
    expectedStatus: 200,
  });
  t.step('second order added');

  const updatedList = await t.request('GET', `/api/invoice?search=${encodeURIComponent(invoiceNo)}`, { expectedStatus: 200 });
  const updatedInvoice = Array.isArray(updatedList.data?.data) ? updatedList.data.data.find((row) => row.invNo === invoiceNo) : null;
  const secondOrder = Array.isArray(updatedInvoice?.orders) ? updatedInvoice.orders.find((row) => row.orderNo === secondaryOrderNo) : null;
  t.assertOk(Boolean(secondOrder?.id), 'second order visible after add');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'assignBranchAdmin',
      invoiceId,
      targetAdminId: branchAdminId,
    },
    expectedStatus: 200,
  });
  t.step('invoice ownership assigned to branch admin');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateOrder',
      orderId: secondOrder.id,
      orderNo: updatedSecondaryOrderNo,
      amount: 350,
      customerMark: mark,
      customerName: mark,
      customerId: secondOrder.customerId || null,
    },
    expectedStatus: 200,
  });
  t.step('second order updated');

  await t.request('POST', '/api/receipt', {
    json: {
      action: 'direct-create',
      receiptNo: `RCPT-${suffix}`,
      usd: 1200,
      orderNo,
      customerMark: mark,
      customerName: mark,
    },
    expectedStatus: 200,
  });
  t.step('receipt direct create works');

  await t.request('POST', '/api/detail', {
    json: {
      action: 'direct-create',
      items: [{ orderNo, amount: 1200 }],
    },
    expectedStatus: 200,
  });
  t.step('detail direct create works');

  const detailList = await t.request('GET', '/api/detail', { expectedStatus: 200 });
  const detailRow = Array.isArray(detailList.data?.data) ? detailList.data.data[0] : null;
  t.assertOk(Boolean(detailRow?.id), 'detail row available for swift linkage');

  await t.request('POST', '/api/swift', {
    json: {
      action: 'direct-create',
      detailId: detailRow.id,
      amount: 1200,
      senderName: 'Sender A',
      receiverName: 'Receiver B',
    },
    expectedStatus: 200,
  });
  t.step('swift direct create works');

  await t.logout();
  await t.login(branchAdminEmail, 'BranchAdmin@2026!');

  const branchInvoiceList = await t.request('GET', `/api/invoice?search=${encodeURIComponent(invoiceNo)}`, { expectedStatus: 200 });
  const branchInvoice = Array.isArray(branchInvoiceList.data?.data) ? branchInvoiceList.data.data.find((row) => row.invNo === invoiceNo) : null;
  t.assertOk(Boolean(branchInvoice?.id), 'assigned branch admin can view invoice');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'updateInvoiceDates',
      invoiceId,
      shipDate: '2026-03-20',
      releaseDate: '2026-03-21',
    },
    expectedStatus: 200,
  });
  t.step('assigned branch admin can manage invoice');

  await t.logout();
  await t.login(salesEmail, 'Sales@2026!');

  const salesInvoiceList = await t.request('GET', `/api/invoice?search=${encodeURIComponent(invoiceNo)}`, { expectedStatus: 200 });
  const salesInvoice = Array.isArray(salesInvoiceList.data?.data) ? salesInvoiceList.data.data.find((row) => row.invNo === invoiceNo) : null;
  t.assertOk(Boolean(salesInvoice?.id), 'sales can view invoice for bound customer');

  const salesReceiptList = await t.request('GET', `/api/receipt?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const salesReceipt = Array.isArray(salesReceiptList.data?.data) ? salesReceiptList.data.data.find((row) => row.orderNo === orderNo) : null;
  t.assertOk(Boolean(salesReceipt?.id), 'sales can view receipt for bound customer');

  const salesDetailList = await t.request('GET', `/api/detail?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const salesDetail = Array.isArray(salesDetailList.data?.data) ? salesDetailList.data.data.find((row) => Array.isArray(row.items) && row.items.some((item) => item.orderNo === orderNo)) : null;
  t.assertOk(Boolean(salesDetail?.id), 'sales can view detail for bound customer');

  const salesSwiftList = await t.request('GET', `/api/swift?search=${encodeURIComponent(orderNo)}`, { expectedStatus: 200 });
  const salesSwift = Array.isArray(salesSwiftList.data?.data)
    ? salesSwiftList.data.data.find((row) => Array.isArray(row.detail?.items)
      && row.detail.items.some((item) => item?.receipt?.orderNo === orderNo || item?.orderNo === orderNo))
    : null;
  t.assertOk(Boolean(salesSwift?.id), 'sales can view swift for bound customer');

  await t.logout();
  await t.loginAdmin();

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'deleteOrder',
      orderId: secondOrder.id,
    },
    expectedStatus: 200,
  });
  t.step('unused order delete works');

  const lateMark = `LATE-${suffix}`;
  const lateOrderBase = `LATEORDER-${suffix}`;
  const lateOrderNo = `${lateOrderBase}-05`;
  const lateInvoiceNo = `INV-LATE-${suffix}`;

  await t.request('POST', '/api/invoice', {
    json: {
      invNo: lateInvoiceNo,
      orders: [
        { orderNo: lateOrderNo, amount: 880, customerMark: lateMark, customerName: '' },
      ],
    },
    expectedStatus: 200,
  });
  t.step('late-bound invoice created before customer exists');

  const lateInvoiceBefore = await t.request('GET', `/api/invoice?search=${encodeURIComponent(lateInvoiceNo)}`, { expectedStatus: 200 });
  const lateInvoiceBeforeRow = Array.isArray(lateInvoiceBefore.data?.data)
    ? lateInvoiceBefore.data.data.find((row) => row.invNo === lateInvoiceNo)
    : null;
  const lateOrderBefore = Array.isArray(lateInvoiceBeforeRow?.orders)
    ? lateInvoiceBeforeRow.orders.find((row) => row.orderNo === lateOrderNo)
    : null;
  t.assertOk(Boolean(lateOrderBefore?.needsCustomerFix), 'late-bound order starts as unresolved');

  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark: lateMark,
      orderName: lateOrderBase,
      name: `Late Customer ${suffix}`,
      phone: `621${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
      ownerId: salesId,
    },
    expectedStatus: 200,
  });
  t.step('late-bound customer created after invoice');

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'rematch',
    },
    expectedStatus: 200,
  });
  t.step('invoice rematch reruns customer resolution for unresolved order');

  const lateInvoiceAfter = await t.request('GET', `/api/invoice?search=${encodeURIComponent(lateInvoiceNo)}`, { expectedStatus: 200 });
  const lateInvoiceAfterRow = Array.isArray(lateInvoiceAfter.data?.data)
    ? lateInvoiceAfter.data.data.find((row) => row.invNo === lateInvoiceNo)
    : null;
  const lateOrderAfter = Array.isArray(lateInvoiceAfterRow?.orders)
    ? lateInvoiceAfterRow.orders.find((row) => row.orderNo === lateOrderNo)
    : null;
  t.assertOk(Boolean(lateOrderAfter?.customerId), 'late-bound order gains customerId after rematch');
  t.assertEqual(Boolean(lateOrderAfter?.needsCustomerFix), false, 'late-bound order clears needsCustomerFix after rematch');

  await t.logout();
}
