import { calculateOrderBalance, validateAmountTolerance } from '@/lib/matching';
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

describe('matching.validateAmountTolerance', () => {
  it('accepts exact +/-5 boundary without warning', () => {
    expect(validateAmountTolerance(100, 105)).toEqual({
      valid: true,
      hasWarning: false,
      message: '金额验证通过',
    });
  });

  it('warns but allows when difference is above 5 and up to 50', () => {
    expect(validateAmountTolerance(100, 106)).toEqual({
      valid: true,
      hasWarning: true,
      message: '金额差异 6.00 超出正常容差(±5)，已标红但允许通过',
    });
    expect(validateAmountTolerance(100, 150)).toEqual({
      valid: true,
      hasWarning: true,
      message: '金额差异 50.00 超出正常容差(±5)，已标红但允许通过',
    });
  });

  it('rejects once difference exceeds 50', () => {
    expect(validateAmountTolerance(100, 151)).toEqual({
      valid: false,
      hasWarning: true,
      message: '金额差异 51.00 超过允许范围(±50)，无法通过验证',
    });
  });

  it('supports custom warning and reject thresholds', () => {
    expect(validateAmountTolerance(100, 103, { warningTolerance: 2, rejectTolerance: 4 })).toEqual({
      valid: true,
      hasWarning: true,
      message: '金额差异 3.00 超出正常容差(±2)，已标红但允许通过',
    });
    expect(validateAmountTolerance(100, 105, { warningTolerance: 2, rejectTolerance: 4 })).toEqual({
      valid: false,
      hasWarning: true,
      message: '金额差异 5.00 超过允许范围(±4)，无法通过验证',
    });
  });
});
