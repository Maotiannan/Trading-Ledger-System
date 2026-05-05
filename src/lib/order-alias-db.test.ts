import { db } from '@/lib/db';
import { findOrderIdByNoOrAliasWithExecutor } from '@/lib/order-alias-db';

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
});
