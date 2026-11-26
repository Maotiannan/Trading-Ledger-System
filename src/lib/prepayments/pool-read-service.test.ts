import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { listPrepaymentCredits } from './transfers';
import { loadDepositPool } from './pool-read-service';
import { isActivePoolRow } from './pool-types';
jest.mock('@/lib/db', () => ({ db: { order: { findMany: jest.fn() }, deletionRequest: { findMany: jest.fn() } } }));
jest.mock('./transfers', () => ({ listPrepaymentCredits: jest.fn() }));
const credit = (extra = {}) => ({ creditId: 'credit', receiptNo: 'R-1', customerLabel: 'DEMOPAY', sourceOrderNo: 'DEMOPAY-03',
  originalOrderId: 'formal-order', sourceOrderId: 'source-order', amount: '3000.00', usedAmount: '2000.00', reservedAmount: '400.00', availableAmount: '600.00',
  held: false, transferred: false, active: true, ...extra });
const decimal = (n: number) => new Prisma.Decimal(n);
beforeEach(() => {
  jest.resetAllMocks();
  (listPrepaymentCredits as jest.Mock).mockResolvedValue({ credits: [credit()] });
  (db.order.findMany as jest.Mock).mockResolvedValue([]);
  (db.deletionRequest.findMany as jest.Mock).mockResolvedValue([]);
});
it('includes unused funding even after its original order has left the pool', async () => {
  const result = await loadDepositPool({ role: 'ADMIN' } as never, ['admin']);
  expect(result).toMatchObject({ availableTotal: '600.00', reservedTotal: '400.00', rows: [{ kind: 'CREDIT', orderId: 'source-order' }] });
});
it('combines old deposits with funded remainders and subtracts legacy transfer encumbrance', async () => {
  (db.order.findMany as jest.Mock).mockResolvedValue([{ id: 'pool', orderNo: 'OTHER', amount: decimal(500),
    customerMark: 'OTHER', customer: null, receipts: [{ id: 'r2', usd: decimal(1500), status: 'RECEIVED' }] }]);
  const result = await loadDepositPool({ role: 'ADMIN' } as never, ['admin']);
  expect(result.availableTotal).toBe('1600.00');
  expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
    receipts: expect.objectContaining({ where: { AND: [expect.any(Object), { funding: null }] } }),
  }) }));
});
it('keeps signature pending and held rows visible without marking their funds available', async () => {
  (listPrepaymentCredits as jest.Mock).mockResolvedValue({ credits: [credit({ held: true, availableAmount: '0.00' })] });
  (db.order.findMany as jest.Mock).mockResolvedValue([{ id: 'pool', orderNo: 'OTHER', amount: decimal(0),
    customerMark: 'OTHER', customer: null, receipts: [{ id: 'r2', usd: decimal(500), status: 'SIGNING_PENDING' }] }]);
  const result = await loadDepositPool({ role: 'ADMIN' } as never, ['admin']);
  expect(result.availableTotal).toBe('0.00'); expect(result.heldTotal).toBe('600.00');
  expect(result.rows.every(isActivePoolRow)).toBe(true);
});
it('hides exhausted rows by default but retains them in history', async () => {
  (listPrepaymentCredits as jest.Mock).mockResolvedValue({ credits: [credit({ usedAmount: '3000.00', reservedAmount: '0.00', availableAmount: '0.00' })] });
  const result = await loadDepositPool({ role: 'ADMIN' } as never, ['admin']);
  expect(result.rows).toHaveLength(1); expect(result.rows.filter(isActivePoolRow)).toEqual([]);
});
it('does not revive a legacy snapshot when the bound customer MARK is blank', async () => {
  (listPrepaymentCredits as jest.Mock).mockResolvedValue({ credits: [] });
  (db.order.findMany as jest.Mock).mockResolvedValue([{ id: 'pool', orderNo: 'ORDER', amount: decimal(0),
    customerMark: 'OLD MARK', customer: { mark: '' }, receipts: [{ id: 'r', usd: decimal(500), status: 'RECEIVED' }] }]);
  const result = await loadDepositPool({ role: 'ADMIN' } as never, ['admin']);
  expect(result.rows[0].customerLabel).toBe('-');
});
it('never exposes a transferred source order through a foreign original identity', async () => {
  (listPrepaymentCredits as jest.Mock).mockResolvedValue({ credits: [credit({ transferred: true, sourceOrderId: null })] });
  const result = await loadDepositPool({ role: 'USER' } as never, ['user']);
  expect(result.rows[0].orderId).toBeNull();
});
