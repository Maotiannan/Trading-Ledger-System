import {
  appCalendarDaysBetween,
  classifyCustomerRisk,
  getCompletedMonthWindow,
  getNaturalYearWindow,
} from './customer-analytics';

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
