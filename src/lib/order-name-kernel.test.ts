import {
  buildCompositeOrderLookupCandidates,
  dedupeOrderNameAliases,
  expandCompositeOrderSegments,
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

  it('expands composite ORDER values into normalized slash segments', () => {
    expect(expandCompositeOrderSegments('PIKIN-23 / PIKIN-19C / PIKIN-23')).toEqual([
      'PIKIN-23',
      'PIKIN-19C',
      'PIKIN-23 / PIKIN-19C / PIKIN-23',
      'PIKIN-19C/PIKIN-23',
    ]);
  });

  it('builds exact-order and ORDER_NAME candidates from slash segments', () => {
    expect(buildCompositeOrderLookupCandidates('PIKIN-23/PIKIN-19C')).toEqual({
      exactOrderNos: ['PIKIN-23', 'PIKIN-19C', 'PIKIN-23/PIKIN-19C', 'PIKIN-19C/PIKIN-23'],
      normalizedOrderNos: ['pikin-23', 'pikin-19c', 'pikin-23/pikin-19c', 'pikin-19c/pikin-23'],
      orderNameCandidates: [
        { orderName: 'PIKIN-23', normalizedOrderName: 'pikin-23' },
        { orderName: 'PIKIN', normalizedOrderName: 'pikin' },
        { orderName: 'PIKIN-19C', normalizedOrderName: 'pikin-19c' },
      ],
      derivedOrderNames: ['PIKIN'],
    });
  });
});
