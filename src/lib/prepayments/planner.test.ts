import { planCreditUse } from './planner';

describe('prepayment allocation without changing receivables', () => {
  it.each([
    ['5000.00', '3000.00', '2000.00', '0.00'],
    ['500.00', '500.00', '0.00', '2500.00'],
    ['2100.00', '2100.00', '0.00', '900.00'],
  ])('allocates a real 3000 receipt against %s', (amount, used, remaining, unused) => {
    const result = planCreditUse(amount, '0.00', [{ creditId: 'a', receiptId: 'r', available: '3000.00', applied: '0.00' }]);
    expect(result.prepaymentAmount).toBe(used);
    expect(result.remainingAmount).toBe(remaining);
    expect(result.unusedAmount).toBe(unused);
  });
  it('preserves this invoice use and reserves only the positive difference', () => {
    const result = planCreditUse('2100.00', '0.00', [{ creditId: 'a', receiptId: 'r', available: '900.00', applied: '2100.00' }]);
    expect(result.allocations).toEqual([{ creditId: 'a', receiptId: 'r', amount: '2100.00' }]);
    expect(result.reservations).toEqual([]);
  });
  it('uses related source orders together without duplicating freight', () => {
    const result = planCreditUse('2100.00', '0.00', [
      { creditId: 'a', receiptId: 'r1', available: '1000.00', applied: '0.00' },
      { creditId: 'b', receiptId: 'r2', available: '2000.00', applied: '0.00' },
    ]);
    expect(result.allocations.map(row => row.amount)).toEqual(['1000.00', '1100.00']);
    expect(result.unusedAmount).toBe('900.00');
  });
  it('reduces allocation, not receivable, for a smaller regenerated invoice', () => {
    const result = planCreditUse('500.00', '0.00', [{ creditId: 'a', receiptId: 'r', available: '0.00', applied: '3000.00' }]);
    expect(result.prepaymentAmount).toBe('500.00');
    expect(result.unusedAmount).toBe('2500.00');
    expect(result.reservations).toEqual([]);
  });
  it('does not replace an already applied source with a newly arrived older source', () => {
    const result = planCreditUse('500.00', '0.00', [
      { creditId: 'new', receiptId: 'r1', available: '500.00', applied: '0.00' },
      { creditId: 'used', receiptId: 'r2', available: '0.00', applied: '500.00' },
    ]);
    expect(result.allocations).toEqual([{ creditId: 'used', receiptId: 'r2', amount: '500.00' }]);
  });
  it('refuses inconsistent raw/direct payments rather than concealing overpayment', () => {
    expect(() => planCreditUse('500.00', '501.00', [])).toThrow();
  });
});
