import { calculateOrderSimilarity, tokenizeOrder } from '@/lib/tokenizer';

describe('tokenizer', () => {
  it('should tokenize order number and include compact token', () => {
    const tokens = tokenizeOrder('RAHIM-08 A');
    expect(tokens).toContain('rahim');
    expect(tokens).toContain('08');
    expect(tokens).toContain('a');
    expect(tokens).toContain('rahim08a');
  });

  it('should give higher score to similar order numbers', () => {
    const high = calculateOrderSimilarity('RAHIM-08', 'RAHIM-8');
    const low = calculateOrderSimilarity('RAHIM-08', 'MAB-99');
    expect(high).toBeGreaterThan(0.45);
    expect(low).toBeLessThan(0.4);
  });
});
