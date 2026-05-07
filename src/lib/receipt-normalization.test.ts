import { normalizeReceiptOcrResult } from './receipt-normalization';

describe('normalizeReceiptOcrResult', () => {
  it('extracts ORDER NO from motif payment text when OCR orderNo is missing', () => {
    expect(normalizeReceiptOcrResult({
      receiptNo: '0000992',
      motif: 'Initial payment for Rahim-11',
      isDeposit: true,
    })).toEqual(expect.objectContaining({
      receiptNo: '0000992',
      orderNo: 'Rahim-11',
      isDeposit: false,
    }));
  });

  it('keeps explicit OCR orderNo before motif fallback', () => {
    expect(normalizeReceiptOcrResult({
      orderNo: 'PIKIN-23',
      motif: 'Payment for PIKIN-19C',
    })).toEqual(expect.objectContaining({
      orderNo: 'PIKIN-23',
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
