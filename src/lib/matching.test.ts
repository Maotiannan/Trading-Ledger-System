import { calculateOrderBalance } from '@/lib/matching';
import { db } from '@/lib/db';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findUnique: jest.fn(),
    },
  },
}));

const mockedFindUnique = db.order.findUnique as jest.Mock;

describe('matching.calculateOrderBalance', () => {
  beforeEach(() => {
    mockedFindUnique.mockReset();
  });

  it('should include RECEIVED receipts in balance calculation', async () => {
    mockedFindUnique.mockResolvedValue({
      id: 'o1',
      amount: 100,
      receipts: [
        { id: 'r1', usd: 30, status: 'SR_Received' },
        { id: 'r2', usd: 20, status: 'RECEIVED' },
      ],
    });

    await expect(calculateOrderBalance('o1')).resolves.toBe(50);
    expect(mockedFindUnique).toHaveBeenCalled();
  });

  it('should return 0 when order does not exist', async () => {
    mockedFindUnique.mockResolvedValue(null);

    await expect(calculateOrderBalance('missing')).resolves.toBe(0);
  });
});
