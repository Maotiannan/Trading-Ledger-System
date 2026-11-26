import { projectOrderPaymentRecords } from './order-payment-records';
jest.mock('@/lib/db', () => ({ db: {} }));
const receipt = (extra = {}) => ({ id: 'receipt', receiptNo: 'R-1', orderId: 'order', usd: 3000, status: 'RECEIVED',
  date: new Date('2026-06-02'), createdAt: new Date('2026-06-02'), payer: 'Payer', invNo: 'INV', orderNo: 'ORDER',
  imageUrl: '/receipt.png', imageName: 'receipt.png', funding: null, ...extra });
const allocation = (extra = {}) => ({ orderId: 'order', state: 'APPLIED', amount: 500, appliedAt: new Date('2026-11-10'),
  funding: { id: 'funding', active: true, originalReceiptId: 'receipt', receipt: { status: 'RECEIVED' } }, ...extra });

it('keeps legacy receipts and excludes signing pending from applied amounts', () => {
  expect(projectOrderPaymentRecords('order', [receipt()], [])[0].appliedToOrderAmount).toBe(3000);
  expect(projectOrderPaymentRecords('order', [receipt({ status: 'SIGNING_PENDING' })], [])[0].appliedToOrderAmount).toBe(0);
});
it('deduplicates a direct funded receipt and allocations while preserving the original amount', () => {
  const rows = projectOrderPaymentRecords('order', [receipt({ funding: { id: 'funding' } })], [allocation(), allocation({ amount: 1500 }), allocation({ orderId: 'other', amount: 1000 })]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ originalReceiptAmount: 3000, appliedToOrderAmount: 2000 });
});
it.each(['RELEASED', 'RESERVED'])('ignores %s rather than double-counting historical allocations', state => {
  expect(projectOrderPaymentRecords('order', [], [allocation({ state })])).toEqual([]);
});
it.each([null, { status: 'SIGNING_PENDING' }])('ignores absent or unfinished receipts', source => {
  expect(projectOrderPaymentRecords('order', [], [allocation({ funding: { id: 'funding', originalReceiptId: 'receipt', active: true, receipt: source } })])).toEqual([]);
});
it('ignores inactive funding', () => {
  const row = allocation(); row.funding.active = false;
  expect(projectOrderPaymentRecords('order', [], [row])).toEqual([]);
});
it('shows a restricted contribution without original receipt, payer, image or gross amount', () => {
  const rows = projectOrderPaymentRecords('order', [], [allocation(), allocation({ amount: 100 })]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: 'allocation:funding', appliedToOrderAmount: 600, originalReceiptAmount: null,
    imageUrl: null, receiptNo: null, payer: null, sourceRestricted: true });
});
