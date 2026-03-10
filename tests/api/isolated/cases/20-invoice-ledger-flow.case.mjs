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

  await t.request('POST', '/api/customer', {
    json: {
      action: 'create',
      mark,
      orderName: mark,
      name: `Customer ${suffix}`,
      phone: `620${Math.floor(Math.random() * 900000 + 100000)}`,
      city: 'Conakry',
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

  await t.request('PUT', '/api/invoice', {
    json: {
      action: 'deleteOrder',
      orderId: secondOrder.id,
    },
    expectedStatus: 200,
  });
  t.step('unused order delete works');

  await t.logout();
}
