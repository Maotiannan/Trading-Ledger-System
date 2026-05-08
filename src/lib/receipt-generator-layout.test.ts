import { amountToWordsUsd, buildReceiptGeneratorLayout } from '@/lib/receipt-generator-layout';

describe('receipt-generator-layout', () => {
  it('formats usd amounts into english words', () => {
    expect(amountToWordsUsd(2500)).toBe('two thousand five hundred US dollars only');
    expect(amountToWordsUsd(2500.5)).toBe('two thousand five hundred one US dollars only');
  });

  it('builds receipt layout with computed balance and motif fields', () => {
    const layout = buildReceiptGeneratorLayout({
      receiptNo: '0001000',
      orderNo: 'Big Alpha-07',
      invNo: 'L25MH060523',
      customerMark: 'Big Alpha',
      customerCompanyName: 'Alpha Trading SARL',
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usdAmount: 2500,
      balanceBefore: 34660,
      paymentMode: 'Transfer',
      generatedAt: new Date('2026-04-27T01:02:03.000Z'),
    });

    expect(layout.clientName).toBe('Alpha Trading SARL "Big Alpha"');
    expect(layout.motif).toBe('Payment for L25MH060523 Big Alpha-07');
    expect(layout.balanceAfter).toBe(32160);
    expect(layout.resteAPayer).toBe('$34,660 - $2,500 = $32,160');
    expect(layout.paymentMode).toBe('Transfer');
    expect(layout.receivedBy).toBe('Mamadou Dian Diallo');
  });

  it('falls back to customer name when company name is blank', () => {
    const layout = buildReceiptGeneratorLayout({
      receiptNo: '0001001',
      orderNo: 'Big Alpha-08',
      invNo: 'L25MH060524',
      customerMark: 'Big Alpha',
      customerCompanyName: '   ',
      customerName: 'Alpha Oumar Diallo',
      clientTel: '628 38 63 63',
      usdAmount: 1,
      balanceBefore: 10,
      generatedAt: new Date('2026-04-27T01:02:03.000Z'),
    });

    expect(layout.clientName).toBe('Alpha Oumar Diallo "Big Alpha"');
  });

  it('defaults payment mode to Cash', () => {
    const layout = buildReceiptGeneratorLayout({
      receiptNo: '0001002',
      orderNo: 'MARY-01',
      invNo: 'L25MH060525',
      customerMark: 'MARY',
      customerCompanyName: null,
      customerName: 'Mamadou Aliou Barry',
      clientTel: '+224 620 07 11 76',
      usdAmount: 20,
      balanceBefore: 100,
    });

    expect(layout.paymentMode).toBe('Cash');
  });
});
