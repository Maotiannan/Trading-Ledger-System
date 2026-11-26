/** @jest-environment node */
import { listMucontOrderConflicts, matchFormalOrders } from './mucont-order-conflicts';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import type { DbTransactionClient } from '@/lib/transaction';
jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/user-hierarchy', () => ({ getHierarchyScope: jest.fn() }));
const row = (id: string, orderNo: string, aliasNo?: string) => ({ id, orderNo,
  aliases: aliasNo ? [{ aliasNo }] : [], invoice: { id: 'invoice-' + id, invNo: 'INV-' + id } });
const item = { key: 'a', displayOrderNo: 'AB-12B', sourceOrderNo: 'AB-12' };
const originalActor = process.env.MUCONT_INVOICE_ACTOR_ID;
afterAll(() => { if (originalActor === undefined) delete process.env.MUCONT_INVOICE_ACTOR_ID; else process.env.MUCONT_INVOICE_ACTOR_ID = originalActor; });
beforeEach(() => { jest.clearAllMocks(); process.env.MUCONT_INVOICE_ACTOR_ID = 'admin'; });
test('returns every exact display match and keeps original-only hits as hints', () => {
  const result = matchFormalOrders([item], [row('1', 'AB-12'), row('2', 'AB-12B/XY-2'), row('3', 'OTHER', 'ab-12b'), row('4', 'AB-12BB')]);
  expect(result[0].matches.map(r => [r.orderId, r.kind])).toEqual([['1', 'SOURCE_HINT'], ['2', 'DISPLAY'], ['3', 'DISPLAY']]);
  expect(result[0].matches[1]).toMatchObject({ invNo: 'INV-2', orderNo: 'AB-12B/XY-2', matchedOrderNo: 'ab-12b' });
});
test('normalizes casing/edge whitespace only, preserves suffixes, supports composite orders', () => {
  expect(matchFormalOrders([{ key: 'a', displayOrderNo: ' ab-12B / XY-2 ' }], [row('1', 'AB-12'), row('2', 'AB-12B')])[0].matches).toHaveLength(1);
  expect(matchFormalOrders([{ key: 'a', displayOrderNo: 'DEMOFX2-07' }], [row('1', 'DEMO FX2-07')])[0].matches).toEqual([]);
});
test('display hit wins over source hint on the same stored order', () => {
  expect(matchFormalOrders([item], [row('1', 'AB-12/AB-12B')])[0].matches.map(r => r.kind)).toEqual(['DISPLAY']);
});
test('service selects all scoped formal orders once, excludes pools and own batch', async () => {
  const tx = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'admin', role: 'ADMIN' }) }, order: { findMany: jest.fn().mockResolvedValue([row('1', 'AB-12B')]) } };
  (getHierarchyScope as jest.Mock).mockResolvedValue({ ownerVisibleIds: new Set(['admin', 'sales']) });
  const result = await listMucontOrderConflicts({ invoiceBatchId: 'batch', items: [item] }, tx as unknown as DbTransactionClient);
  expect(result.items[0].matches).toHaveLength(1);
  expect(tx.order.findMany).toHaveBeenCalledTimes(1);
  expect(tx.order.findMany.mock.calls[0][0].where).toMatchObject({ invoice: {
    invNo: { notIn: expect.arrayContaining(['DEPOSIT_POOL', 'Un_Associated']) },
    OR: [{ mucontSource: null }, { mucontSource: { invoiceBatchId: { not: 'batch' } } }],
  }, OR: expect.any(Array) });
  expect(JSON.stringify(tx.order.findMany.mock.calls[0][0].where)).toContain('sales');
});
test.each([null, { invoiceBatchId: '', items: [] }, { invoiceBatchId: 'b', items: [item, item] },
  { invoiceBatchId: 'b', items: Array.from({ length: 501 }, (_, i) => ({ ...item, key: String(i) })) }])('rejects malformed or oversized queries', async input => {
  await expect(listMucontOrderConflicts(input)).rejects.toMatchObject({ status: 422 });
});
test('fails closed if service actor is disabled or missing', async () => {
  const tx = { user: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as DbTransactionClient;
  await expect(listMucontOrderConflicts({ invoiceBatchId: 'batch', items: [item] }, tx)).rejects.toMatchObject({ status: 503 });
});
