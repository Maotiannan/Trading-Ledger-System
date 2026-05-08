import { calculateOrderBalance, findMatchingOrder, validateAmountTolerance } from '@/lib/matching';
import { db } from '@/lib/db';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAlias: jest.fn(),
  mapOrderIdsByOrderNos: jest.fn(),
  syncOrderAliases: jest.fn(),
}));

const mockedFindMany = db.order.findMany as jest.Mock;
const mockedFindUnique = db.order.findUnique as jest.Mock;
const mockedFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;

describe('matching.calculateOrderBalance', () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
    mockedFindUnique.mockReset();
    mockedFindOrderIdByNoOrAlias.mockReset();
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

describe('matching.findMatchingOrder', () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
    mockedFindUnique.mockReset();
    mockedFindOrderIdByNoOrAlias.mockReset();
  });

  it('does not match an unregistered order to another order in the same prefix group', async () => {
    mockedFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);
    mockedFindMany.mockResolvedValueOnce([
      {
        id: 'order-ab-07',
        orderNo: 'AB-07',
        amount: 110630,
        orderBalance: 36058,
        tokens: '["ab","07","ab07"]',
      },
    ]);

    await expect(findMatchingOrder('AB-13B')).resolves.toBeNull();
  });

  it('still matches the same order number ignoring case', async () => {
    mockedFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);
    mockedFindMany.mockResolvedValueOnce([
      {
        id: 'order-ab-13b',
        orderNo: 'AB-13B',
        amount: 4000,
        orderBalance: 0,
        tokens: '["ab","13b","ab13b"]',
      },
    ]);

    await expect(findMatchingOrder('ab-13b')).resolves.toEqual({
      orderId: 'order-ab-13b',
      orderNo: 'AB-13B',
      amount: 4000,
      orderBalance: 0,
    });
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
      message: '金额差异 $6 超出正常容差(±5)，已标红但允许通过',
    });
    expect(validateAmountTolerance(100, 150)).toEqual({
      valid: true,
      hasWarning: true,
      message: '金额差异 $50 超出正常容差(±5)，已标红但允许通过',
    });
  });

  it('rejects once difference exceeds 50', () => {
    expect(validateAmountTolerance(100, 151)).toEqual({
      valid: false,
      hasWarning: true,
      message: '金额差异 $51 超过允许范围(±50)，无法通过验证',
    });
  });

  it('supports custom warning and reject thresholds', () => {
    expect(validateAmountTolerance(100, 103, { warningTolerance: 2, rejectTolerance: 4 })).toEqual({
      valid: true,
      hasWarning: true,
      message: '金额差异 $3 超出正常容差(±2)，已标红但允许通过',
    });
    expect(validateAmountTolerance(100, 105, { warningTolerance: 2, rejectTolerance: 4 })).toEqual({
      valid: false,
      hasWarning: true,
      message: '金额差异 $5 超过允许范围(±4)，无法通过验证',
    });
  });
});
