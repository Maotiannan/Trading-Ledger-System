import { db } from '@/lib/db';
import { runFinancialTransaction } from '@/lib/transaction';
import { updateOrderBalance } from '@/lib/order-balance-service';
import { restoreRecoveryEntry, archiveForRecovery } from '@/lib/recovery-service';

const prefix = `prepay-it-${Date.now()}`;
let serial = 0;
const name = () => `${prefix}-${++serial}`;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '3313' || url.pathname !== '/muledger_prepayment_20261111') {
    throw new Error('Refusing non-isolated prepayment database');
  }
});
afterAll(async () => { await db.$disconnect(); });

async function fixture(pool = true) {
  const id = name();
  const customer = await db.customer.create({ data: { name: id, mark: id, normalizedMark: id, orderName: id,
    phone: '', city: '', ownerId: 'prepay-admin', createdBy: 'prepay-admin' } });
  const invoice = await db.invoice.upsert({ where: { invNo: pool ? 'DEPOSIT_POOL' : id },
    create: { invNo: pool ? 'DEPOSIT_POOL' : id, createdBy: 'prepay-admin' }, update: {} });
  const order = await db.order.create({ data: { invoiceId: invoice.id, orderNo: id, customerId: customer.id,
    amount: pool ? 0 : 100, orderBalance: pool ? 0 : 100, paymentAllocationMode: true, createdBy: 'prepay-admin' } });
  const receipt = await runFinancialTransaction(tx => tx.receipt.create({ data: {
    orderId: order.id, orderNo: id, customerId: customer.id, usd: 300, status: 'RECEIVED', createdBy: 'prepay-admin',
  } }));
  return { order, receipt };
}

test('unused receipt re-signing restores the existing root and credit without new income', async () => {
  const { receipt } = await fixture();
  const original = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: receipt.id }, include: { credits: true } });
  await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'SIGNING_PENDING' } }));
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: original.id } })).active).toBe(false);
  await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'SR_Received' } }));
  const restored = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: receipt.id }, include: { credits: true } });
  expect(restored.id).toBe(original.id);
  expect(restored.active).toBe(true);
  expect(restored.credits).toHaveLength(1);
  expect(restored.credits[0].id).toBe(original.credits[0].id);
  expect(restored.credits[0].amount.toFixed(2)).toBe('300.00');
});

test('restoring a deleted pending receipt reconnects its funding root before finalizing', async () => {
  const { receipt } = await fixture();
  const root = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: receipt.id } });
  const pending = await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'SIGNING_PENDING' } }));
  await runFinancialTransaction(tx => tx.receipt.delete({ where: { id: receipt.id } }));
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).receiptId).toBeNull();
  await runFinancialTransaction(tx => tx.receipt.create({ data: pending }));
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).receiptId).toBe(receipt.id);
  await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'RECEIVED' } }));
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).active).toBe(true);
  expect(await db.receiptFunding.count({ where: { originalReceiptId: receipt.id } })).toBe(1);
});

test('applied receipts cannot be deleted or edited and failed writes preserve history', async () => {
  const { order, receipt } = await fixture(false);
  const before = await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
  await expect(runFinancialTransaction(async tx => {
    await tx.receiptHistory.deleteMany({ where: { receiptId: receipt.id } });
    await tx.receipt.delete({ where: { id: receipt.id } });
  })).rejects.toMatchObject({ status: 409 });
  await expect(runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { usd: 200 } })))
    .rejects.toMatchObject({ status: 409 });
  expect(await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(before);
  expect((await runFinancialTransaction(tx => updateOrderBalance(order.id, tx))).computed).toBe(0);
});

test('the existing recovery service preserves receipt identity, history, and its original funding root', async () => {
  const { receipt } = await fixture();
  const root = await db.receiptFunding.findUniqueOrThrow({ where: { receiptId: receipt.id } });
  const pending = await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'SIGNING_PENDING' } }));
  const session = await db.receiptGeneratorSession.create({ data: { receiptId: receipt.id, receiptNo: name(), orderNo: receipt.orderNo!, usd: receipt.usd, createdBy: 'prepay-admin' } });
  const history = await db.receiptHistory.create({ data: { receiptId: receipt.id, usd: receipt.usd, status: 'SIGNING_PENDING', createdBy: 'prepay-admin' } });
  const entry = await runFinancialTransaction(async tx => {
    const archived = await archiveForRecovery(tx, { kind: 'SIGNING_RECEIPT', resourceId: receipt.id, ownerId: 'prepay-admin',
      snapshot: { receipt: pending, session, histories: [history], editRequests: [] }, files: [], now: new Date() });
    await tx.receiptGeneratorSession.delete({ where: { id: session.id } });
    await tx.receiptHistory.delete({ where: { id: history.id } });
    await tx.receipt.delete({ where: { id: receipt.id } });
    return archived;
  });
  const admin = await db.user.findUniqueOrThrow({ where: { id: 'prepay-admin' } });
  expect(await restoreRecoveryEntry(admin, entry.id)).toMatchObject({ restored: true, alreadyRestored: false });
  expect(await restoreRecoveryEntry(admin, entry.id)).toMatchObject({ alreadyRestored: true });
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).receiptId).toBe(receipt.id);
  expect(await db.receiptHistory.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
  await runFinancialTransaction(tx => tx.receipt.update({ where: { id: receipt.id }, data: { status: 'RECEIVED' } }));
  expect((await db.receiptFunding.findUniqueOrThrow({ where: { id: root.id } })).active).toBe(true);
});
