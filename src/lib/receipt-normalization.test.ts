import { normalizeReceiptOcrResult } from './receipt-normalization';

describe('normalizeReceiptOcrResult', () => {
  it.each([
    [true, true],
    ['true', true],
    [' TRUE ', true],
    [false, false],
    ['false', false],
    [undefined, false],
    [null, false],
    ['unknown', false],
  ])('preserves an explicit OCR deposit flag %p as %p across both normalizations', (isDeposit, expected) => {
    const result = normalizeReceiptOcrResult({ orderNo: 'DPT-02', usd: 500, isDeposit });
    expect(result.isDeposit).toBe(expected);
    expect(normalizeReceiptOcrResult({ ...result }).isDeposit).toBe(expected);
  });

  it('extracts ORDER NO from motif payment text when OCR orderNo is missing', () => {
    expect(normalizeReceiptOcrResult({
      receiptNo: '0000992',
      motif: 'Initial payment for Rahim-11',
      isDeposit: true,
    })).toEqual(expect.objectContaining({
      receiptNo: '0000992',
      orderNo: 'Rahim-11',
      isDeposit: true,
    }));
  });

  it('keeps explicit OCR orderNo before motif fallback', () => {
    expect(normalizeReceiptOcrResult({
      orderNo: 'KITEM-23',
      motif: 'Payment for KITEM-19C',
    })).toEqual(expect.objectContaining({
      orderNo: 'KITEM-23',
      isDeposit: false,
    }));
  });

  it('extracts invoice and order separately when motif contains both values', () => {
    expect(normalizeReceiptOcrResult({
      motif: 'Payment for L25MH060523 Big Alpha-07',
    })).toEqual(expect.objectContaining({
      invNo: 'L25MH060523',
      orderNo: 'Big Alpha-07',
    }));
  });
});
