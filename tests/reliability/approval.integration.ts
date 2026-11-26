import { db } from '@/lib/db';
import { reviewReceiptEdit } from '@/lib/receipt-edit-request-service';
import { reviewDetailEdit } from '@/lib/detail-edit-request-service';
import { reviewDeletionRequest } from '@/lib/deletion-service';
import { createManagedUser, updateManagedUserRole, resetManagedUserPassword } from '@/lib/auth-service';

let admin: Awaited<ReturnType<typeof db.user.create>>, sales: typeof admin, branchAdmin: typeof admin;
let count = 0;
const name = () => `approval-${Date.now()}-${++count}`;
type Kind = 'receipt' | 'detail';
type Decision = 'approve' | 'reject';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.MULEDGER_RELIABILITY_ISOLATED !== 'true' || url.hostname !== '127.0.0.1' || url.pathname !== '/muledger_reliability_test') throw Error('Requires the disposable reliability database');
  admin = await db.user.create({ data: { email: name() + '@example.invalid', password: 'disabled-login', role: 'ADMIN', level: 1 } });
  branchAdmin = await db.user.create({ data: { email: name() + '@example.invalid', password: 'disabled-login', role: 'ADMIN', level: 2, parentId: admin.id } });
  sales = await db.user.create({ data: { email: name() + '@example.invalid', password: 'disabled-login', role: 'SALES', level: 3, parentId: branchAdmin.id } });
});
afterAll(() => db.$disconnect());

async function fixture(kind: Kind, legacy = false) {
  const invoice = await db.invoice.create({ data: { invNo: name(), createdBy: sales.id } });
  const order = await db.order.create({ data: { orderNo: name(), invoiceId: invoice.id, amount: 20, orderBalance: 0, createdBy: sales.id } });
  const receipt = await db.receipt.create({ data: { receiptNo: name(), orderId: order.id, orderNo: order.orderNo,
    invNo: invoice.invNo, payer: 'Original', usd: 20, status: 'SR_Received', createdBy: sales.id } });
  if (kind === 'receipt') {
    const old = { payer: 'Original', receiptNo: receipt.receiptNo, date: null, invNo: invoice.invNo, orderNo: order.orderNo, customerMark: null, tel: null };
    const req = await db.receiptEditRequest.create({ data: { receiptId: receipt.id, requestedBy: sales.id, pendingReceiptId: receipt.id,
      beforeSnapshot: legacy ? { receiptNo: receipt.receiptNo } : old, afterSnapshot: { ...old, payer: 'Requested' } } });
    return { id: req.id, decide: (decision: Decision, reviewer = admin) => reviewReceiptEdit({ currentUser: reviewer, requestId: req.id, decision }),
      state: async () => (await db.receiptEditRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
      change: () => db.receipt.update({ where: { id: receipt.id }, data: { payer: 'Current' } }),
      value: async () => (await db.receipt.findUniqueOrThrow({ where: { id: receipt.id } })).payer,
      initial: 'Original', wanted: 'Requested', changed: 'Current', key: 'payer', targetId: receipt.id };
  }
  const items = [{ mark: null, orderNo: order.orderNo, amount: 20, receiptId: receipt.id }];
  const detail = await db.detail.create({ data: { date: new Date('2020-01-01'), createdBy: sales.id, totalAmount: 20, items: { create: items } } });
  const before = { date: '2020-01-01', agentId: null, items };
  const req = await db.detailEditRequest.create({ data: { detailId: detail.id, pendingDetailId: detail.id, requestedBy: sales.id,
    beforeSnapshot: legacy ? { items } : before, afterSnapshot: { ...before, date: '2020-01-02' } } });
  return { id: req.id, decide: (decision: Decision, reviewer = admin) => reviewDetailEdit({ currentUser: reviewer, requestId: req.id, decision }),
    state: async () => (await db.detailEditRequest.findUniqueOrThrow({ where: { id: req.id } })).status,
    change: () => db.detail.update({ where: { id: detail.id }, data: { date: new Date('2020-01-03') } }),
    value: async () => (await db.detail.findUniqueOrThrow({ where: { id: detail.id } })).date?.toISOString().slice(0, 10),
    initial: before.date, wanted: '2020-01-02', changed: '2020-01-03', key: 'date', targetId: detail.id };
}

async function failingAudit(fn: () => Promise<void>) {
  await db.$executeRawUnsafe('RENAME TABLE AuditLog TO ApprovalTestUnavailableAudit');
  try { await fn(); } finally { await db.$executeRawUnsafe('RENAME TABLE ApprovalTestUnavailableAudit TO AuditLog'); }
}
describe.each<Kind>(['receipt', 'detail'])('%s decisions', kind => {
  test('rechecks the committed value after waiting for another writer', async () => {
    const f = await fixture(kind);
    let pending!: Promise<unknown>;
    await db.$transaction(async writer => {
      if (kind === 'receipt') await writer.receipt.update({ where: { id: f.targetId }, data: { payer: 'Concurrent' } });
      else await writer.detailItem.updateMany({ where: { detailId: f.targetId }, data: { amount: 18 } });
      pending = f.decide('approve').then(() => 'unexpected approval', error => error);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [r] = await writer.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits`;
        if (Number(r.n)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw Error('No InnoDB waiter observed');
    }, { timeout: 10000 });
    expect(await pending).toMatchObject({ code: 'APPROVAL_BASELINE_CONFLICT', detail: { fields: expect.arrayContaining([expect.objectContaining({ field: kind === 'receipt' ? 'payer' : 'items' })]) } });
    expect(await f.state()).toBe('PENDING'); expect(await db.auditLog.count({ where: { targetId: f.id } })).toBe(0);
  });
  test.each([false, true])('retains current values when stale or unprovable (legacy %s)', async legacy => {
    const f = await fixture(kind, legacy);
    await f.change();
    await expect(f.decide('approve')).rejects.toMatchObject({ status: 409, detail: { fields: expect.arrayContaining([
      { field: f.key, known: !legacy, before: legacy ? null : f.initial, requested: f.wanted, current: f.changed },
    ]) } });
    expect(await f.state()).toBe('PENDING'); expect(await f.value()).toBe(f.changed);
    expect(await db.auditLog.count({ where: { targetId: f.id } })).toBe(0);
    await f.decide('reject'); expect(await f.state()).toBe('REJECTED');
  });
  test.each<Decision>(['approve', 'reject'])('one decision wins when approve races %s', async other => {
    const f = await fixture(kind);
    const results = await Promise.allSettled([f.decide('approve'), f.decide(other, branchAdmin)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const state = await f.state();
    if (other === 'approve') expect(state).toBe('APPROVED');
    expect(await f.value()).toBe(state === 'APPROVED' ? f.wanted : f.initial);
    await expect(f.decide(other)).rejects.toThrow();
    expect(await db.auditLog.count({ where: { targetId: f.id } })).toBe(1);
  });
  test.each<Decision>(['approve', 'reject'])('audit failure rolls back %s', async decision => {
    const f = await fixture(kind);
    await failingAudit(async () => { await expect(f.decide(decision)).rejects.toMatchObject({ code: 'P2021' }); });
    expect(await f.state()).toBe('PENDING'); expect(await f.value()).toBe(f.initial);
    expect(await db.auditLog.count({ where: { targetId: f.id } })).toBe(0);
  });
});
test('different administrators racing a deletion approval and rejection leave exactly one matching result', async () => {
  const f = await fixture('receipt');
  const req = await db.deletionRequest.create({ data: { targetType: 'RECEIPT', targetId: f.targetId, requestedBy: sales.id, reason: 'race' } });
  const decide = (action: Decision) => reviewDeletionRequest({ currentUser: action === 'approve' ? admin : branchAdmin, action, requestId: req.id });
  const [approve, reject] = await Promise.allSettled([decide('approve'), decide('reject')]);
  expect([approve, reject].filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const approved = approve.status === 'fulfilled';
  expect(await db.deletionRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({
    status: approved ? 'APPROVED' : 'REJECTED', approvedBy: approved ? admin.id : branchAdmin.id,
  });
  expect(await db.receipt.count({ where: { id: f.targetId } })).toBe(approved ? 0 : 1);
  await expect(decide('reject')).rejects.toThrow();
  expect(await db.auditLog.findMany({ where: { targetId: f.targetId, action: { in: ['DELETION_REQUEST_APPROVE', 'DELETION_REQUEST_REJECT'] } } })).toEqual([
    expect.objectContaining({ action: approved ? 'DELETION_REQUEST_APPROVE' : 'DELETION_REQUEST_REJECT',
      actorId: approved ? admin.id : branchAdmin.id, metadata: { requestId: req.id } }),
  ]);
});
test('delete decision and user administration roll back on a database audit error', async () => {
  const f = await fixture('receipt');
  const req = await db.deletionRequest.create({ data: { targetType: 'RECEIPT', targetId: f.targetId, requestedBy: sales.id, reason: 'isolated' } });
  const account = await db.user.create({ data: { email: name() + '@example.invalid', password: 'unchanged', role: 'USER', level: 4, parentId: admin.id } });
  const email = name() + '@example.invalid';
  await failingAudit(async () => {
    for (const action of ['approve', 'reject'] as const) {
      await expect(reviewDeletionRequest({ currentUser: admin, action, requestId: req.id })).rejects.toMatchObject({ code: 'P2021' });
      expect((await db.deletionRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('PENDING');
      expect(await f.value()).toBe(f.initial);
    }
    await expect(createManagedUser(admin, { email, password: 'Test-password1!', role: 'USER' })).rejects.toMatchObject({ code: 'P2021' });
    await expect(updateManagedUserRole(admin, { userId: account.id, role: 'SALES' })).rejects.toMatchObject({ code: 'P2021' });
    await expect(resetManagedUserPassword(admin, { userId: account.id, password: 'Test-password2!' })).rejects.toMatchObject({ code: 'P2021' });
  });
  expect(await db.user.findUnique({ where: { email } })).toBeNull();
  expect(await db.user.findUniqueOrThrow({ where: { id: account.id } })).toEqual(account);
});
