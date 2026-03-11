export const name = 'customer-fix-flow';

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('customer-fix');
  const orderNo = `FIX-${suffix}-01`;
  const invNo = `INV-${suffix}`;
  const unknownMark = `UNKNOWN-${suffix}`;

  const createInvoice = await t.request('POST', '/api/invoice', {
    json: {
      invNo,
      orders: [
        {
          orderNo,
          amount: 1234,
          customerMark: unknownMark,
        },
      ],
    },
    expectedStatus: 200,
  });
  t.assertOk(Boolean(createInvoice.data?.data?.id), 'invoice with unresolved customer created');

  const fixesBefore = await t.request('GET', '/api/customer/fixes', { expectedStatus: 200 });
  const ordersBefore = Array.isArray(fixesBefore.data?.data?.orders) ? fixesBefore.data.data.orders : [];
  const targetOrder = ordersBefore.find((row) => row.orderNo === orderNo);
  t.assertOk(Boolean(targetOrder?.id), 'customer fix queue exposes unresolved order');

  const resolveOrder = await t.request('POST', '/api/customer/fixes', {
    json: {
      action: 'resolve-order',
      orderId: targetOrder.id,
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima Diallo',
      phone: '622443103',
      city: 'Conakry',
    },
    expectedStatus: 200,
  });
  t.assertMatch(
    resolveOrder.data?.message || '',
    /订单客户信息已修复|Order customer information fixed/,
    'customer fix order resolve succeeds',
  );

  const fixesAfter = await t.request('GET', '/api/customer/fixes', { expectedStatus: 200 });
  const ordersAfter = Array.isArray(fixesAfter.data?.data?.orders) ? fixesAfter.data.data.orders : [];
  t.assertOk(!ordersAfter.some((row) => row.id === targetOrder.id), 'resolved order disappears from customer fix queue');

  await t.logout();
}
