/** @jest-environment node */
import { guardPrepaymentWrites } from './write-guards';
jest.mock('@/lib/order-balance-service', () => ({}));
jest.mock('@/lib/audit', () => ({}));
function client() {
  return { receiptFunding: {}, receipt: { findMany: jest.fn().mockResolvedValue([
    { id: 'draft', orderId: 'canceled', status: 'SIGNING_PENDING', funding: null },
  ]) }, order: { count: jest.fn(async ({ where }) => where.id.in.includes('canceled') ? 1 : 0) },
  mucontInvoiceGroup: { findMany: jest.fn().mockResolvedValue([]) } };
}
it('rejects creating or finalizing a payment against a canceled order', async () => {
  for (const [method, data, ids] of [
    ['create', { orderId: 'canceled' }, []],
    ['update', { status: 'RECEIVED' }, ['draft']],
  ] as const) {
    await expect(guardPrepaymentWrites(client() as never, 'receipt', method, { data }, [...ids])).rejects.toMatchObject({ status: 409 });
  }
});
it('allows rebinding an unfinished draft from a canceled order to an active one', async () => {
  const tx = client();
  await guardPrepaymentWrites(tx as never, 'receipt', 'update', { data: { orderId: 'active' } }, ['draft']);
  expect(tx.order.count).toHaveBeenCalledWith({ where: { id: { in: ['active'] }, canceledAt: { not: null } } });
});
it('does not prevent deleting an unfunded canceled-order draft', async () => {
  const tx = client();
  await guardPrepaymentWrites(tx as never, 'receipt', 'delete', {}, ['draft']);
  expect(tx.order.count).not.toHaveBeenCalled();
});
it('keeps the existing allocated-order guard against legacy amount transfers', async () => {
  const tx = client(); tx.order.count.mockResolvedValue(1);
  await expect(guardPrepaymentWrites(tx as never, 'order', 'update', { data: { amount: 100 } }, ['funded']))
    .rejects.toMatchObject({ status: 409 });
});
