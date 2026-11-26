import { PrismaClient, ReceiptStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { transferInvoiceBalance } from '@/lib/invoice-service';
import { repairOrderBalanceCacheIfNeeded, updateOrderBalance, assertReceiptRemovalDoesNotStrandTransfer } from '@/lib/order-balance-service';
import { runFinancialTransaction } from '@/lib/transaction';
import { lockReceiptBalances, lockOrderBalances, lockOrderSnapshots } from '@/lib/order-balance-lock';
import { getDashboardSummary } from '@/lib/dashboard-summary-service';
import { updateReceiptRecord } from '@/lib/receipt-service';
import { reviewDeletionRequest } from '@/lib/deletion-service';
import { reverseTransferReceipt } from '@/lib/balance-transfer-reversal-service';

const observer = new PrismaClient();
let actor: Awaited<ReturnType<typeof db.user.create>>;
let serial = 0;
const label = () => `reliability-${Date.now()}-${++serial}`;

function assertIsolation() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.MULEDGER_RELIABILITY_ISOLATED !== 'true' || url.hostname !== '127.0.0.1'
    || url.pathname !== '/muledger_reliability_test') throw new Error('Requires the isolated reliability MySQL database');
}

async function order(amount = 100, paid = 150, pending = 0) {
  const invoice = await db.invoice.create({ data: { invNo: label(), createdBy: actor.id } });
  const row = await db.order.create({ data: { invoiceId: invoice.id, orderNo: label(), amount, orderBalance: amount - paid, createdBy: actor.id } });
  if (paid) await db.receipt.create({ data: { orderId: row.id, orderNo: row.orderNo, usd: paid, status: 'SR_Received', createdBy: actor.id } });
  if (pending) await db.receipt.create({ data: { orderId: row.id, orderNo: row.orderNo, usd: pending, status: 'SIGNING_PENDING', createdBy: actor.id } });
  return row;
}

async function waitForLockWaits(minimum = 1) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const [row] = await observer.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM performance_schema.data_lock_waits`;
    if (Number(row.count) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Did not observe ${minimum} real InnoDB lock waits`);
}

async function holdOrder(id: string) {
  let acquired!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = observer.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
    acquired();
    await gate;
  }, { timeout: 15000 });
  await ready;
  return { release, done };
}

beforeAll(async () => {
  assertIsolation();
  actor = await db.user.create({ data: { email: `${label()}@example.invalid`, password: 'test-not-a-login', role: 'ADMIN', level: 1 } });
});
afterAll(async () => { await Promise.all([db.$disconnect(), observer.$disconnect()]); });

test('two concurrent transfers of 40 cannot spend an overpayment of 50 twice', async () => {
  const source = await order();
  const [a, b] = await Promise.all([order(100, 0), order(100, 0)]);
  const held = await holdOrder(source.id);
  const transfers = Promise.allSettled([a, b].map((target) => transferInvoiceBalance(actor, {
    fromOrderId: source.id, toOrderNo: target.orderNo, transferAmount: 40, requestId: label(),
  })));
  try { await waitForLockWaits(2); } finally { held.release(); }
  await held.done;
  const results = await transfers;
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 400, detail: { available: 10 } } });
  const updated = await db.order.findUniqueOrThrow({ where: { id: source.id } });
  expect(Number(updated.orderBalance)).toBe(-10);
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { targetId: source.id, action: 'ORDER_TRANSFER_BALANCE' } })).toBe(1);
});

test('pending signatures do not increase transferable money', async () => {
  const source = await order(100, 150, 100);
  const target = await order(100, 0);
  await expect(transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: target.orderNo, transferAmount: 80, requestId: label() }))
    .rejects.toMatchObject({ status: 400, detail: { available: 50 } });
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(0);
});

test('same mutation intent concurrent retry commits exactly one receipt and transfer', async () => {
  const source = await order();
  const target = await order(100, 0);
  const payload = { fromOrderId: source.id, toOrderNo: target.orderNo, transferAmount: 40, requestId: label() };
  const results = await Promise.all([transferInvoiceBalance(actor, payload), transferInvoiceBalance(actor, payload)]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(1);
  expect(await db.receipt.count({ where: { orderId: target.id } })).toBe(1);
  await expect(transferInvoiceBalance(actor, { ...payload, transferAmount: 5 })).rejects.toMatchObject({ status: 409 });
});

test('an unrelated order is not blocked by a locked order transfer', async () => {
  const [source, other, a, b] = await Promise.all([order(), order(), order(100, 0), order(100, 0)]);
  const held = await holdOrder(source.id);
  const blocked = transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: a.orderNo, transferAmount: 40, requestId: label() });
  try {
    await waitForLockWaits();
    await Promise.race([
      transferInvoiceBalance(actor, { fromOrderId: other.id, toOrderNo: b.orderNo, transferAmount: 40, requestId: label() }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Unrelated order was blocked')), 2500); timer.unref(); }),
    ]);
    expect(await db.balanceTransfer.count({ where: { fromOrderId: other.id } })).toBe(1);
  } finally { held.release(); await held.done; await blocked; }
});

test('repair waits for the order lock before reading and never overwrites new payment with an old snapshot', async () => {
  const source = await order(100, 0);
  let release!: () => void;
  let acquired!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const payment = observer.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${source.id} FOR UPDATE`;
    acquired();
    await gate;
    await tx.receipt.create({ data: { orderId: source.id, usd: 60, status: ReceiptStatus.RECEIVED, createdBy: actor.id } });
    await tx.order.update({ where: { id: source.id }, data: { orderBalance: 40 } });
  }, { timeout: 15000 });
  await ready;
  const repair = repairOrderBalanceCacheIfNeeded({ ...source, orderBalance: 999, receipts: [] }, db, { actorId: actor.id, source: 'isolation-test' });
  try { await waitForLockWaits(); } finally { release(); }
  await payment;
  const result = await repair;
  expect(result.computed).toBe(40);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).orderBalance)).toBe(40);
});

test('a used overpayment cannot be removed leaving a stranded transfer', async () => {
  const source = await order();
  const target = await order(100, 0);
  await transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: target.orderNo, transferAmount: 40, requestId: label() });
  const receipt = await db.receipt.findFirstOrThrow({ where: { orderId: source.id } });
  await expect(runFinancialTransaction(async (tx) => {
    await lockReceiptBalances(tx, [receipt.id]);
    await assertReceiptRemovalDoesNotStrandTransfer(tx, source.id, receipt.usd, receipt.status);
    await tx.receipt.delete({ where: { id: receipt.id } });
    await updateOrderBalance(source.id, tx);
  })).rejects.toMatchObject({ status: 409 });
  expect(await db.receipt.count({ where: { id: receipt.id } })).toBe(1);
});

test('dashboard summary computes correct balances and does not repair caches on GET', async () => {
  const row = await order(28674, 10000);
  await db.receipt.create({ data: { orderId: row.id, usd: 15000, status: 'Waiting_SWIFT', createdBy: actor.id } });
  await db.order.update({ where: { id: row.id }, data: { orderBalance: 38674 } });
  const before = await db.order.findUniqueOrThrow({ where: { id: row.id } });
  const audits = await db.auditLog.count();
  const result = await getDashboardSummary(actor);
  expect(Number(result.unpaidTotal)).toBeGreaterThanOrEqual(3674);
  const after = await db.order.findUniqueOrThrow({ where: { id: row.id } });
  expect(Number(after.orderBalance)).toBe(38674);
  expect(after.updatedAt).toEqual(before.updatedAt);
  expect(await db.auditLog.count()).toBe(audits);
  await runFinancialTransaction(async (tx) => { await lockOrderBalances(tx, [row.id]); await updateOrderBalance(row.id, tx); });
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: row.id } })).orderBalance)).toBe(3674);
});

test('merge snapshot is validated after locking, rather than applying an old amount', async () => {
  const source = await order(100, 0);
  await db.order.update({ where: { id: source.id }, data: { amount: 200, updatedAt: new Date(source.updatedAt.getTime() + 1000) } });
  await expect(runFinancialTransaction((tx) => lockOrderSnapshots(tx, [source]))).rejects.toMatchObject({ status: 409 });
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).amount)).toBe(200);
});

test('upsert update and checked relation connect use destination order locks', async () => {
  const source = await order(100, 25);
  const target = await order(100, 0);
  const receipt = await db.receipt.findFirstOrThrow({ where: { orderId: source.id } });
  const held = await holdOrder(target.id);
  const update = runFinancialTransaction(async (tx) => {
    await tx.receipt.upsert({ where: { id: receipt.id }, create: { usd: 25, createdBy: actor.id },
      update: { order: { connect: { id: target.id } } } });
    await updateOrderBalance(source.id, tx);
    await updateOrderBalance(target.id, tx);
  });
  try { await waitForLockWaits(); } finally { held.release(); }
  await held.done;
  await update;
  expect((await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).orderId).toBe(target.id);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).orderBalance)).toBe(100);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: target.id } })).orderBalance)).toBe(75);
});

test('transfer competing with receipt rebinding never spends money removed from the source', async () => {
  const source = await order();
  const [transferTarget, rebindTarget] = await Promise.all([order(100, 0), order(100, 0)]);
  const receipt = await db.receipt.findFirstOrThrow({ where: { orderId: source.id } });
  const held = await holdOrder(source.id);
  const results = Promise.allSettled([
    transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: transferTarget.orderNo, transferAmount: 40, requestId: label() }),
    updateReceiptRecord({ currentUser: actor, receiptId: receipt.id, payload: { receiptNo: receipt.receiptNo,
      date: null, tel: null, orderNo: rebindTarget.orderNo, invNo: null, customerMark: null, payer: null } }),
  ]);
  try { await waitForLockWaits(2); } finally { held.release(); }
  await held.done;
  const settled = await results;
  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(settled.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: expect.any(Number) } });
  const moved = (await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).orderId !== source.id;
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(moved ? 0 : 1);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).orderBalance)).toBe(moved ? 100 : -10);
});

test('transfer competing with approved receipt deletion cannot leave a half transfer or lost payment', async () => {
  const source = await order();
  const target = await order(100, 0);
  const receipt = await db.receipt.findFirstOrThrow({ where: { orderId: source.id } });
  const request = await db.deletionRequest.create({ data: { targetType: 'RECEIPT', targetId: receipt.id, requestedBy: actor.id } });
  const held = await holdOrder(source.id);
  const results = Promise.allSettled([
    transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: target.orderNo, transferAmount: 40, requestId: label() }),
    reviewDeletionRequest({ currentUser: actor, action: 'approve', requestId: request.id }),
  ]);
  try { await waitForLockWaits(2); } finally { held.release(); }
  await held.done;
  const settled = await results;
  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const exists = Boolean(await db.receipt.findUnique({ where: { id: receipt.id } }));
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(exists ? 1 : 0);
  expect((await db.deletionRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(exists ? 'PENDING' : 'APPROVED');
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).orderBalance)).toBe(exists ? -10 : 100);
});

test('transfer reversal competing with a new transfer preserves both balances and intent tombstones', async () => {
  const source = await order();
  const [first, second] = await Promise.all([order(100, 0), order(100, 0)]);
  const input = { fromOrderId: source.id, toOrderNo: first.orderNo, transferAmount: 40, requestId: label() };
  await transferInvoiceBalance(actor, input);
  const transfer = await db.balanceTransfer.findFirstOrThrow({ where: { fromOrderId: source.id } });
  if (!transfer.generatedReceiptId) throw new Error('Transfer receipt was not created');
  const generatedReceiptId = transfer.generatedReceiptId;
  const held = await holdOrder(source.id);
  const results = Promise.allSettled([
    reverseTransferReceipt({ currentUser: actor, receiptId: generatedReceiptId }),
    transferInvoiceBalance(actor, { fromOrderId: source.id, toOrderNo: second.orderNo, transferAmount: 40, requestId: label() }),
  ]);
  try { await waitForLockWaits(2); } finally { held.release(); }
  await held.done;
  const settled = await results;
  expect(settled[0].status).toBe('fulfilled');
  const newTransfer = settled[1].status === 'fulfilled';
  expect(await db.balanceTransfer.count({ where: { fromOrderId: source.id } })).toBe(newTransfer ? 1 : 0);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: source.id } })).orderBalance)).toBe(newTransfer ? -10 : -50);
  expect(Number((await db.order.findUniqueOrThrow({ where: { id: first.id } })).orderBalance)).toBe(100);
  await transferInvoiceBalance(actor, input);
  expect(await db.balanceTransfer.count({ where: { id: transfer.id } })).toBe(0);
  expect(await db.receipt.count({ where: { id: generatedReceiptId } })).toBe(0);
});
