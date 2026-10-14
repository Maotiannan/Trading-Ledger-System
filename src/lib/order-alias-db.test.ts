import { db } from '@/lib/db';
import { findOrderIdByNoOrAliasWithExecutor, mapOrderIdsByOrderNosWithExecutor } from '@/lib/order-alias-db';

jest.mock('@/lib/db', () => ({
  db: {
    orderAlias: {
      findFirst: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  orderAlias: { findFirst: jest.Mock };
  order: { findFirst: jest.Mock; findMany: jest.Mock };
};

describe('order-alias-db', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches a slash-composite order row by segment even when alias rows are stale', async () => {
    mockDb.orderAlias.findFirst.mockResolvedValueOnce(null);
    mockDb.order.findFirst.mockResolvedValueOnce(null);
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-1', orderNo: 'PIKIN-23/PIKIN-19C' },
    ]);

    const matched = await findOrderIdByNoOrAliasWithExecutor(mockDb as never, 'PIKIN-23');

    expect(mockDb.orderAlias.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ aliasNo: 'pikin-23' }),
    }));
    expect(mockDb.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: [expect.objectContaining({ orderNo: { contains: 'PIKIN-23' } })],
          }),
        ]),
      }),
    }));
    expect(matched).toBe('order-1');
  });

  it('matches a legacy space-composite order row by segment without treating normal spaced order names as composite', async () => {
    mockDb.orderAlias.findFirst.mockResolvedValueOnce(null);
    mockDb.order.findFirst.mockResolvedValueOnce(null);
    mockDb.order.findMany.mockResolvedValueOnce([
      { id: 'order-space-composite', orderNo: 'AB-13B AB-12B' },
      { id: 'order-normal-space', orderNo: 'OUMAR LAH-01' },
    ]);

    const matched = await findOrderIdByNoOrAliasWithExecutor(mockDb as never, 'AB-13B');

    expect(matched).toBe('order-space-composite');
  });
});

it('prefers independent SADIO-09 even when a composite owns its alias', async () => {
  const executor = { order: { findFirst: jest.fn().mockResolvedValue({ id: 'independent' }) }, orderAlias: { findFirst: jest.fn().mockResolvedValue({ orderId: 'composite' }) } };
  expect(await findOrderIdByNoOrAliasWithExecutor(executor as never, 'SADIO-09')).toBe('independent');
  expect(executor.orderAlias.findFirst).not.toHaveBeenCalled();
});
it('looks up the complete composite rather than its individual components first', async () => {
  const executor = { order: { findFirst: jest.fn().mockResolvedValue({ id: 'composite' }) } };
  expect(await findOrderIdByNoOrAliasWithExecutor(executor as never, 'SADIO-08D/SADIO-09')).toBe('composite');
  expect(executor.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ orderNo: { equals: 'SADIO-08D/SADIO-09' } }] } }));
});
it('retains visible alias fallback when no independent order exists', async () => {
  const scope = { createdBy: { in: ['visible-owner'] } };
  const executor = { order: { findFirst: jest.fn().mockResolvedValue(null) }, orderAlias: { findFirst: jest.fn().mockResolvedValue({ orderId: 'composite' }) } };
  expect(await findOrderIdByNoOrAliasWithExecutor(executor as never, 'SADIO-09', scope)).toBe('composite');
  expect(executor.order.findFirst.mock.calls[0][0].where.AND).toContainEqual(scope);
  expect(executor.orderAlias.findFirst.mock.calls[0][0].where.order).toEqual(scope);
});

it('batch lookup keeps exact orders and resolves only remaining aliases', async () => {
  const executor = { order: { findMany: jest.fn().mockResolvedValue([{ id: 'standalone', orderNo: 'SADIO-09' }]) }, orderAlias: { findMany: jest.fn().mockResolvedValue([{ aliasNo: 'sadio-08d', orderId: 'composite' }]) } };
  const result = await mapOrderIdsByOrderNosWithExecutor(executor as never, ['SADIO-09', 'SADIO-08D']);
  expect(result.get('sadio-09')).toBe('standalone');
  expect(result.get('sadio-08d')).toBe('composite');
  expect(executor.orderAlias.findMany.mock.calls[0][0].where.aliasNo.in).toEqual(['sadio-08d']);
});
