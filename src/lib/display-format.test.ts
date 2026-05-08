import {
  formatMoneyInputValue,
  formatOrderNameDisplay,
  formatUsdAmount,
  normalizeMoneyInputValue,
  parseDisplayMoney,
  roundDisplayMoney,
} from './display-format';

describe('display-format', () => {
  it('formats USD values with international thousands and no decimals', () => {
    expect(formatUsdAmount(1234567.49)).toBe('$1,234,567');
    expect(formatUsdAmount(1234567.5)).toBe('$1,234,568');
    expect(formatUsdAmount('$1,234.60')).toBe('$1,235');
    expect(formatUsdAmount(-25.5)).toBe('-$26');
  });

  it('normalizes money input while keeping display formatting separate', () => {
    expect(normalizeMoneyInputValue('$1,234.50')).toBe('1234.50');
    expect(parseDisplayMoney('1,234.50')).toBe(1234.5);
    expect(roundDisplayMoney('1,234.50')).toBe(1235);
    expect(formatMoneyInputValue('1234.5')).toBe('1,235');
  });

  it('uppercases order names for display without mutating empty fallbacks', () => {
    expect(formatOrderNameDisplay('Super Dt2-09')).toBe('SUPER DT2-09');
    expect(formatOrderNameDisplay('', 'N/A')).toBe('N/A');
  });
});
