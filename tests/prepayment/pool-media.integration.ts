import { db } from '@/lib/db';
import { createReceiptRecord } from '@/lib/receipt-service';
import { createReceiptGeneratorSession } from '@/lib/receipt-generator-service';
import { resolveReceiptEditBinding } from '@/lib/receipt-edit-binding';
import { promoteUnassociatedDepositOrder } from '@/lib/deposit-order-routing';
import { runFinancialTransaction } from '@/lib/transaction';
import { syncOrderAliases } from '@/lib/order-alias-db';
import type { CurrentUser } from '@/lib/request-auth';

let admin: CurrentUser;
let poolId: string;
let unmatchedId: string;
let customerId: string;
let sequence = 0;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '3337' || url.pathname !== '/muledger_pool_media_test') throw new Error('Dedicated synthetic DB required');
  admin = await db.user.create({ data: { id: 'pool-media-admin', email: 'pool-media@example.invalid', password: 'not-used', role: 'ADMIN', level: 1 } });
  poolId = (await db.invoice.create({ data: { invNo: 'DEPOSIT_POOL', createdBy: admin.id } })).id;
  unmatchedId = (await db.invoice.create({ data: { invNo: 'Un_Associated', createdBy: admin.id } })).id;
  customerId = (await db.customer.create({ data: { mark: 'POOLTEST', normalizedMark: 'pooltest', orderName: 'POOLTEST', name: 'Synthetic Customer', phone: '', city: '', createdBy: admin.id, ownerId: admin.id } })).id;
  await db.prepaymentMutex.create({ data: { id: 'ledger' } });
});
afterAll(async () => { await db.$disconnect(); });
async function order(invoiceId = unmatchedId, amount = 0) {
  const row = await db.order.create({ data: { orderNo: `POOLTEST-${++sequence}`, invoiceId, amount, orderBalance: amount, customerId, customerMark: 'POOLTEST', customerName: 'POOLTEST', createdBy: admin.id } });
  await db.$transaction(tx => syncOrderAliases(tx, row.id, row.orderNo));
  return row;
}
test('real receipt creation reuses an unmatched order, moves it to deposits and counts income once', async () => {
  const source = await order();
  const result = await createReceiptRecord({ currentUser: admin, mode: 'confirm', payload: { receiptNo: null, date: null, tel: null, invNo: 'Un_Associated', payer: null, customerMark: 'POOLTEST', customerId, orderNo: source.orderNo, usd: 500, isDeposit: true } });
  expect(result.data.orderId).toBe(source.id);
  expect(result.data.isDeposit).toBe(true);
  expect(result.data.invNo).toBeNull();
  const updated = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  expect(updated.invoiceId).toBe(poolId);
  expect(updated.amount.toFixed(2)).toBe('0.00');
  expect(updated.orderBalance.toFixed(2)).toBe('-500.00');
  expect(await db.receipt.count({ where: { orderId: source.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'ORDER_DEPOSIT_POOL_ASSIGN', targetId: source.id } })).toBe(1);
});
test('deposit receipt cannot remove a real invoice order', async () => {
  const invoice = await db.invoice.create({ data: { invNo: 'REAL-TEST', createdBy: admin.id } });
  const source = await order(invoice.id, 1000);
  await createReceiptRecord({ currentUser: admin, mode: 'direct-create', payload: { receiptNo: null, date: null, tel: null, invNo: null, payer: null, customerMark: 'POOLTEST', customerId, orderNo: source.orderNo, usd: 500, isDeposit: true } });
  const updated = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  expect(updated.invoiceId).toBe(invoice.id);
  expect(updated.orderBalance.toFixed(2)).toBe('500.00');
});
test('signed deposit creation promotes its existing unmatched order without recognizing pending income', async () => {
  const source = await order();
  await createReceiptGeneratorSession(admin, { orderNo: source.orderNo, usdAmount: 200, paymentType: 'Deposit' });
  const updated = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  expect(updated.invoiceId).toBe(poolId);
  expect(updated.orderBalance.toFixed(2)).toBe('0.00');
  expect((await db.receipt.findFirstOrThrow({ where: { orderId: source.id } })).status).toBe('SIGNING_PENDING');
});
test('editing a deposit binding promotes only an unmatched zero-amount order', async () => {
  const source = await order();
  const binding = await runFinancialTransaction(tx => resolveReceiptEditBinding(tx, { currentUserId: admin.id, ownerIds: [admin.id],
    orderNo: source.orderNo, invNo: null, isDeposit: true, customerId, customerMark: 'POOLTEST', customerName: 'POOLTEST', customerPhone: null, customerCity: null, needsCustomerFix: false }));
  expect(binding.invNo).toBe('DEPOSIT_POOL');
  expect((await db.order.findUniqueOrThrow({ where: { id: source.id } })).invoiceId).toBe(poolId);
});
test('a failed transaction rolls back both pool promotion and its audit', async () => {
  const source = await order();
  await expect(runFinancialTransaction(async tx => { await promoteUnassociatedDepositOrder(tx, source.id, admin.id); throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
  expect((await db.order.findUniqueOrThrow({ where: { id: source.id } })).invoiceId).toBe(unmatchedId);
  expect(await db.auditLog.count({ where: { targetId: source.id } })).toBe(0);
});
