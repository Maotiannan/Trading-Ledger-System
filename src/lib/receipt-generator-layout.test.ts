import { amountToWordsUsd, buildReceiptGeneratorLayout } from '@/lib/receipt-generator-layout';

describe('receipt-generator-layout', () => {
  it('formats usd amounts into english words', () => {
    expect(amountToWordsUsd(2500)).toBe('two thousand five hundred US dollars only');
    expect(amountToWordsUsd(2500.5)).toBe('two thousand five hundred US dollars and fifty cents');
  });

  it('builds receipt layout with computed balance and motif fields', () => {
    const layout = buildReceiptGeneratorLayout({
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usdAmount: 2500,
      balanceBefore: 34660,
      generatedAt: new Date('2026-04-27T01:02:03.000Z'),
    });

    expect(layout.clientName).toBe('Alpha Oumar Diallo "Big Alpha"');
    expect(layout.motif).toBe('Payment for L25MH060523 Big Alpha-07');
    expect(layout.balanceAfter).toBe(32160);
    expect(layout.resteAPayer).toBe('$34660.00 - $2500.00 = $32160.00');
    expect(layout.receivedBy).toBe('Mamadou Dian Diallo');
  });
});
