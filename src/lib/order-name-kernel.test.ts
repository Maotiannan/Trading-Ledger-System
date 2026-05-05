import {
  dedupeOrderNameAliases,
  extractOrderNamePrefix,
  normalizeOrderIdentifier,
} from '@/lib/order-name-kernel';

describe('order-name-kernel', () => {
  it('normalizes identifiers by removing all spaces and lowercasing', () => {
    expect(normalizeOrderIdentifier('SUPER DT 2')).toBe('superdt2');
    expect(normalizeOrderIdentifier('S U P E R D T 2')).toBe('superdt2');
    expect(normalizeOrderIdentifier('  MAB-1  ')).toBe('mab-1');
    expect(normalizeOrderIdentifier('M A B - 1')).toBe('mab-1');
  });

  it('extracts the order-name prefix from an order number before the final dash', () => {
    expect(extractOrderNamePrefix('SUPER DT 2-01')).toBe('SUPER DT 2');
    expect(extractOrderNamePrefix('S U P E R D T 2 -01')).toBe('S U P E R D T 2');
    expect(extractOrderNamePrefix('MAB-1-10B')).toBe('MAB-1');
    expect(extractOrderNamePrefix('INVALID')).toBeNull();
  });

  it('deduplicates aliases by normalized identifier while preserving the first display value', () => {
    expect(dedupeOrderNameAliases(['MAB-1', ' M A B - 1 ', 'MARY', 'MARY '])).toEqual([
      { orderName: 'MAB-1', normalizedOrderName: 'mab-1' },
      { orderName: 'MARY', normalizedOrderName: 'mary' },
    ]);
  });
});
