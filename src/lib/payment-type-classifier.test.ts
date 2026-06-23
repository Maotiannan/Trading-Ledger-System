import {
  classifyPaymentType,
  mapPaymentTypeClassificationToReceiptGenerator,
} from '@/lib/payment-type-classifier';

describe('payment-type-classifier', () => {
  it('classifies a first real-invoice payment that clears the balance as Full payment', () => {
    const type = classifyPaymentType({
      balanceAfter: 0,
      isPoolOrder: false,
      isDepositPayment: false,
      isFirstPayment: true,
    });

    expect(type).toBe('Full payment');
    expect(mapPaymentTypeClassificationToReceiptGenerator(type)).toBe('Full');
  });

  it('classifies a first real-invoice payment with remaining balance as Initial', () => {
    const type = classifyPaymentType({
      balanceAfter: 100,
      isPoolOrder: false,
      isDepositPayment: false,
      isFirstPayment: true,
    });

    expect(type).toBe('Initial');
    expect(mapPaymentTypeClassificationToReceiptGenerator(type)).toBe('Initial');
  });

  it('classifies an existing-payment real invoice that clears the balance as Final', () => {
    const type = classifyPaymentType({
      balanceAfter: 0,
      isPoolOrder: false,
      isDepositPayment: false,
      isFirstPayment: false,
    });

    expect(type).toBe('Final');
    expect(mapPaymentTypeClassificationToReceiptGenerator(type)).toBe('Final');
  });

  it('classifies an existing-payment real invoice with remaining balance as Standard', () => {
    const type = classifyPaymentType({
      balanceAfter: 100,
      isPoolOrder: false,
      isDepositPayment: false,
      isFirstPayment: false,
    });

    expect(type).toBe('Std');
    expect(mapPaymentTypeClassificationToReceiptGenerator(type)).toBe('Standard');
  });

  it('classifies deposit pool payments as Deposit instead of Initial', () => {
    const type = classifyPaymentType({
      balanceAfter: null,
      isPoolOrder: true,
      isDepositPayment: true,
      isFirstPayment: true,
    });

    expect(type).toBe('Deposit');
    expect(mapPaymentTypeClassificationToReceiptGenerator(type)).toBe('Deposit');
  });
});
