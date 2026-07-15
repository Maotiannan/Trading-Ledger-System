import {
  appCalendarDaysBetween,
  calculateAnnualAmountRanking,
  calculatePaymentCapacityRanking,
  calculatePaymentCycleRanking,
  classifyCustomerRisk,
  getCompletedMonthWindow,
  getNaturalYearWindow,
} from './customer-analytics';
import type {
  CustomerAnalyticsCustomerInput,
  CustomerAnalyticsOrderInput,
  CustomerAnalyticsReceiptInput,
} from './customer-analytics-types';

const settings = {
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
};

describe('customer analytics periods and risk bands', () => {
  const asOf = new Date('2026-07-15T12:00:00.000Z');

  it('uses the previous twelve completed Guinea calendar months', () => {
    expect(getCompletedMonthWindow(asOf, 12)).toEqual({
      start: new Date('2025-07-01T00:00:00.000Z'),
      endExclusive: new Date('2026-07-01T00:00:00.000Z'),
    });
  });

  it('builds a Guinea natural-year window', () => {
    expect(getNaturalYearWindow(2026)).toEqual({
      start: new Date('2026-01-01T00:00:00.000Z'),
      endExclusive: new Date('2027-01-01T00:00:00.000Z'),
    });
  });

  it('compares Guinea calendar dates rather than elapsed hours', () => {
    expect(appCalendarDaysBetween(
      new Date('2026-06-14T23:30:00.000Z'),
      new Date('2026-07-15T00:30:00.000Z'),
    )).toBe(31);
  });

  it.each([
    [0, 'normal'],
    [30, 'normal'],
    [31, 'mild-delay'],
    [59, 'mild-delay'],
    [60, 'some-delay'],
    [89, 'some-delay'],
    [90, 'delayed'],
    [119, 'delayed'],
    [120, 'warning'],
    [149, 'warning'],
    [150, 'double-warning'],
    [179, 'double-warning'],
    [180, 'severe-warning'],
    [365, 'severe-warning'],
  ])('classifies %d rounded days as %s', (days, expected) => {
    expect(classifyCustomerRisk(days, settings).id).toBe(expected);
  });

  it('rejects non-finite risk input instead of hiding invalid data', () => {
    expect(() => classifyCustomerRisk(Number.NaN, settings)).toThrow('Payment-cycle days must be finite');
  });
});

const customers: CustomerAnalyticsCustomerInput[] = [
  { id: 'customer-a', companyName: 'Alpha Company', name: 'Alpha Person', mark: 'ALPHA' },
  { id: 'customer-b', companyName: null, name: 'Beta Person', mark: 'BETA' },
  { id: 'customer-zero', companyName: null, name: 'Zero Person', mark: 'ZERO' },
];

function receipt(
  id: string,
  usd: number,
  date: string | null,
  options: Partial<CustomerAnalyticsReceiptInput> = {},
): CustomerAnalyticsReceiptInput {
  return {
    id,
    usd,
    status: 'RECEIVED',
    date: date ? new Date(`${date}T00:00:00.000Z`) : null,
    createdAt: new Date(`${date || '2026-01-15'}T00:00:00.000Z`),
    isDeposit: false,
    ...options,
  };
}

function order(
  id: string,
  customerId: string,
  amount: number,
  releaseDate: string | null,
  options: Partial<CustomerAnalyticsOrderInput> = {},
): CustomerAnalyticsOrderInput {
  return {
    id,
    customerId,
    orderNo: id.toUpperCase(),
    invNo: `INV-${id.toUpperCase()}`,
    releaseDate: releaseDate ? new Date(`${releaseDate}T00:00:00.000Z`) : null,
    amount,
    receipts: [],
    ...options,
  };
}

describe('customer annual order amount', () => {
  it('groups released orders by canonical customer and selected release year', () => {
    const result = calculateAnnualAmountRanking({
      customers,
      orders: [
        order('alpha-01', 'customer-a', 100_000, '2026-01-15'),
        order('alpha-02', 'customer-a', 25_000, '2026-06-01'),
        order('beta-01', 'customer-b', 100_000, '2026-02-01'),
        order('alpha-old', 'customer-a', 7_500, '2025-12-01'),
        order('alpha-missing', 'customer-a', 5_000, null),
        order('deposit', 'customer-a', 90_000, '2026-03-01', { invNo: 'DEPOSIT_POOL' }),
        order('unassociated', 'customer-a', 80_000, '2026-03-01', { invNo: 'Un_Associated' }),
      ],
      year: 2026,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        rank: 1,
        customerId: 'customer-a',
        customerName: 'Alpha Company',
        mark: 'ALPHA',
        value: 125_000,
      }),
      expect.objectContaining({
        rank: 2,
        customerId: 'customer-b',
        customerName: 'Beta Person',
        mark: 'BETA',
        value: 100_000,
      }),
    ]);
    expect(result.items.some((row) => row.customerId === 'customer-zero')).toBe(false);
    expect(result.availableYears).toEqual([2025, 2026]);
    expect(result.quality.missingReleaseDateOrders).toBe(1);
    expect(result.quality.missingReleaseDateAmount).toBe(5_000);
    expect(result.detailsByCustomer['customer-a'].orders.map((row) => row.orderNo)).toEqual([
      'ALPHA-02',
      'ALPHA-01',
    ]);
  });

  it('uses stable customer identity ordering when annual amounts tie', () => {
    const result = calculateAnnualAmountRanking({
      customers,
      orders: [
        order('alpha-01', 'customer-a', 100, '2026-01-01'),
        order('beta-01', 'customer-b', 100, '2026-01-01'),
      ],
      year: 2026,
    });

    expect(result.items.map((row) => row.customerId)).toEqual(['customer-a', 'customer-b']);
  });
});

describe('customer payment capacity', () => {
  it('averages formal customer receipts over the previous completed months', () => {
    const duplicate = receipt('duplicate', 1_000, '2025-12-20', { isDeposit: true });
    const result = calculatePaymentCapacityRanking({
      customers,
      orders: [
        order('alpha-01', 'customer-a', 100_000, '2026-01-15', {
          receipts: [
            receipt('received', 3_000, '2025-08-15'),
            receipt('bank', 2_000, '2025-09-15', { status: 'Bank_Transfer' }),
            receipt('waiting', 2_000, '2025-10-15', { status: 'Waiting_SWIFT' }),
            receipt('sr', 2_000, '2025-11-15', { status: 'SR_Received' }),
            duplicate,
            receipt('fallback', 2_000, null, { createdAt: new Date('2026-01-15T00:00:00.000Z') }),
            receipt('pending-signature', 9_000, '2026-02-15', { status: 'SIGNING_PENDING' }),
            receipt('future', 5_000, '2026-08-01'),
            receipt('before-window', 5_000, '2025-06-30'),
            receipt('invalid', -10, '2026-03-01'),
          ],
        }),
        order('alpha-02', 'customer-a', 25_000, null, { receipts: [duplicate] }),
      ],
      asOf: new Date('2026-07-15T12:00:00.000Z'),
      settings,
    });

    expect(result.period).toEqual({
      start: new Date('2025-07-01T00:00:00.000Z'),
      endExclusive: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(result.items[0]).toEqual(expect.objectContaining({
      rank: 1,
      customerId: 'customer-a',
      value: 1_000,
    }));
    expect(result.items.find((row) => row.customerId === 'customer-zero')).toEqual(expect.objectContaining({
      value: 0,
    }));
    expect(result.quality.receiptDateFallbacks).toBe(1);
    expect(result.quality.futureDatedReceipts).toBe(1);
    expect(result.quality.invalidReceiptAmounts).toBe(1);

    const detail = result.detailsByCustomer['customer-a'];
    expect(detail.total).toBe(12_000);
    expect(detail.averageMonthly).toBe(1_000);
    expect(detail.months).toHaveLength(12);
    expect(detail.months.map((month) => month.month)).toEqual([
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ]);
    expect(detail.months.find((month) => month.month === '2025-07')?.total).toBe(0);
    expect(detail.months.find((month) => month.month === '2025-12')?.receipts).toHaveLength(1);
  });
});

describe('customer amount-weighted payment cycle', () => {
  it('calculates the approved partial-payment example as 52 days', () => {
    const result = calculatePaymentCycleRanking({
      customers: [customers[0]],
      orders: [order('alpha-cycle', 'customer-a', 100_000, '2026-01-01', {
        receipts: [
          receipt('prepay', 30_000, '2025-12-20'),
          receipt('payment-40', 40_000, '2026-02-10'),
          receipt('payment-100', 20_000, '2026-04-11'),
        ],
      })],
      asOf: new Date('2026-06-10T00:00:00.000Z'),
      settings,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        customerId: 'customer-a',
        rawValue: 52,
        roundedDays: 52,
        value: 52,
        overdueOutstanding: 10_000,
        riskBand: expect.objectContaining({ id: 'mild-delay' }),
      }),
    ]);
    expect(result.detailsByCustomer['customer-a']).toEqual(expect.objectContaining({
      eligibleOrderCount: 1,
      eligibleAmount: 100_000,
      paidAmount: 90_000,
      overdueOutstanding: 10_000,
      withinTermsOutstanding: 0,
    }));
    expect(result.detailsByCustomer['customer-a'].orders[0]).toEqual(expect.objectContaining({
      rawDays: 52,
      roundedDays: 52,
      paidAmount: 90_000,
      outstanding: 10_000,
    }));
  });

  it('keeps open day-30 money within terms and starts scoring it on day 31', () => {
    const asOf = new Date('2026-07-15T00:00:00.000Z');
    const result = calculatePaymentCycleRanking({
      customers: [customers[0]],
      orders: [
        order('within-terms', 'customer-a', 500, '2026-06-15'),
        order('entered-cycle', 'customer-a', 1_000, '2026-06-14'),
      ],
      asOf,
      settings,
    });

    expect(result.items[0]).toEqual(expect.objectContaining({ roundedDays: 31, overdueOutstanding: 1_000 }));
    expect(result.detailsByCustomer['customer-a']).toEqual(expect.objectContaining({
      eligibleOrderCount: 1,
      eligibleAmount: 1_000,
      withinTermsOutstanding: 500,
    }));
  });

  it('excludes old paid history but never hides old open debt', () => {
    const result = calculatePaymentCycleRanking({
      customers: [customers[0]],
      orders: [
        order('old-paid', 'customer-a', 1_000, '2025-01-01', {
          receipts: [receipt('old-paid-receipt', 1_000, '2025-01-11')],
        }),
        order('old-open', 'customer-a', 500, '2025-01-01'),
      ],
      asOf: new Date('2026-07-15T00:00:00.000Z'),
      settings,
    });

    expect(result.detailsByCustomer['customer-a'].orders.map((row) => row.orderNo)).toEqual(['OLD-OPEN']);
    expect(result.items[0].overdueOutstanding).toBe(500);
  });

  it('counts full prepayment as zero days and caps cycle allocation at order amount', () => {
    const result = calculatePaymentCycleRanking({
      customers: [customers[0], customers[1]],
      orders: [
        order('prepaid', 'customer-a', 100, '2026-01-01', {
          receipts: [receipt('prepaid-receipt', 100, '2025-12-20', { isDeposit: true })],
        }),
        order('overpaid', 'customer-b', 100, '2026-01-01', {
          receipts: [receipt('overpaid-receipt', 200, '2026-04-11')],
        }),
      ],
      asOf: new Date('2026-06-10T00:00:00.000Z'),
      settings,
    });

    expect(result.items.find((row) => row.customerId === 'customer-a')).toEqual(expect.objectContaining({
      roundedDays: 0,
      riskBand: expect.objectContaining({ id: 'normal' }),
    }));
    expect(result.items.find((row) => row.customerId === 'customer-b')).toEqual(expect.objectContaining({
      roundedDays: 100,
    }));
    expect(result.detailsByCustomer['customer-b'].paidAmount).toBe(100);
  });

  it('reports invalid and future payment data without changing the formula', () => {
    const result = calculatePaymentCycleRanking({
      customers: [customers[0]],
      orders: [
        order('invalid-order', 'customer-a', -1, '2026-01-01'),
        order('quality-order', 'customer-a', 100, '2026-01-01', {
          receipts: [
            receipt('invalid-payment', -5, '2026-02-01'),
            receipt('future-payment', 100, '2026-08-01'),
          ],
        }),
      ],
      asOf: new Date('2026-06-10T00:00:00.000Z'),
      settings,
    });

    expect(result.quality.invalidOrderAmounts).toBe(1);
    expect(result.quality.invalidReceiptAmounts).toBe(1);
    expect(result.quality.futureDatedReceipts).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ roundedDays: 160, overdueOutstanding: 100 }));
  });
});
