import { createRequire } from 'node:module';
const { PrismaClient } = createRequire(import.meta.url)('@prisma/client');
export const name = 'order-exact-match';

export default async function run(t) {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '3307' || url.pathname !== '/trading_ledger_test') throw new Error('Isolated database required');
  await t.initAdmin();
  await t.loginAdmin();
  const db = new PrismaClient();
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { email: process.env.INIT_ADMIN_EMAIL } });
    const suffix = t.unique('exact').toUpperCase();
    const singleNo = `SADIO${suffix}-09`;
    const otherNo = `SADIO${suffix}-08D`;
    const compositeNo = `${otherNo}/${singleNo}`;
    const customer = await db.customer.create({ data: { name: 'Synthetic SADIO', mark: suffix, normalizedMark: suffix.toLowerCase(), phone: '620000001', city: 'Conakry', orderName: suffix, ownerId: owner.id, createdBy: owner.id } });
    const orders = [];
    for (const [index, orderNo] of [singleNo, compositeNo].entries()) {
      const invoice = await db.invoice.create({ data: { invNo: `INV-${suffix}-${index}`, createdBy: owner.id } });
      orders.push(await db.order.create({ data: { orderNo, invoiceId: invoice.id, amount: index ? 9842 : 142629, orderBalance: index ? 9842 : 142629, createdBy: owner.id, customerId: customer.id, customerMark: suffix, customerName: suffix } }));
    }
    await db.orderAlias.createMany({ data: [singleNo, otherNo].map(aliasNo => ({ aliasNo: aliasNo.toLowerCase(), orderId: orders[1].id })) });
    for (const [input, expected] of [[singleNo, singleNo], [singleNo.toLowerCase(), singleNo], [otherNo, compositeNo], [compositeNo, compositeNo]]) {
      const response = await t.request('GET', `/api/receipt-generator?action=order-context&orderNo=${encodeURIComponent(input)}`, { expectedStatus: 200 });
      t.assertEqual(response.data.data.orderNo, expected, `generator matches ${input}`);
    }
    const created = await t.request('POST', '/api/receipt', { json: { action: 'direct-create', receiptNo: `R-${suffix}`, usd: 100, orderNo: singleNo, customerMark: suffix, customerName: suffix }, expectedStatus: 200 });
    t.assertOk(created.data.success, 'receipt created');
    const receipt = await db.receipt.findFirstOrThrow({ where: { receiptNo: `R-${suffix}` } });
    t.assertEqual(receipt.orderId, orders[0].id, 'saved receipt belongs to independent order, not composite');
    const composite = await db.order.findUniqueOrThrow({ where: { id: orders[1].id } });
    t.assertEqual(Number(composite.orderBalance), 9842, 'composite balance unchanged');
  } finally { await db.$disconnect(); }
  await t.logout();
}
