import { promoteUnassociatedDepositOrder } from './deposit-order-routing';
import { ensureDepositPoolInvoice } from './matching';
jest.mock('./matching', () => ({ ensureDepositPoolInvoice: jest.fn().mockResolvedValue('deposit-pool') }));
jest.mock('./order-balance-lock', () => ({ lockOrderBalances: jest.fn() }));
const row = { id: 'order', orderNo: 'DPT-02', invoiceId: 'unassociated', invoice: { invNo: 'Un_Associated' }, amount: 0, canceledAt: null, createdBy: 'owner' };
function client(overrides = {}) {
  return { order: { findUnique: jest.fn().mockResolvedValue({ ...row, ...overrides }), update: jest.fn() }, auditLog: { create: jest.fn() } };
}
beforeEach(() => jest.clearAllMocks());
test('moves only the binding of an unbilled unmatched order and audits in the same transaction', async () => {
  const tx = client();
  expect(await promoteUnassociatedDepositOrder(tx as never, 'order', 'actor')).toBe(true);
  expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'order' }, data: { invoiceId: 'deposit-pool' } });
  expect(ensureDepositPoolInvoice).toHaveBeenCalledWith('owner', tx);
  expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    actorId: 'actor', targetId: 'order', metadata: expect.objectContaining({ before: { invoiceId: 'unassociated' }, after: { invoiceId: 'deposit-pool' } }),
  }) }));
});
test.each([
  { invoice: { invNo: 'L26-REAL' } }, { invoice: { invNo: 'DEPOSIT_POOL' } },
  { amount: 100 }, { canceledAt: new Date() }, { paymentAllocationMode: true },
])('does not move a real, funded, already pooled or canceled order: %p', async overrides => {
  const tx = client(overrides);
  expect(await promoteUnassociatedDepositOrder(tx as never, 'order', 'actor')).toBe(false);
  expect(tx.order.update).not.toHaveBeenCalled();
  expect(tx.auditLog.create).not.toHaveBeenCalled();
});
