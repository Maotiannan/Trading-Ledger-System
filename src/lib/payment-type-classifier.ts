import type { ReceiptGeneratorPaymentType } from '@/lib/receipt-generator-layout';

export const DEPOSIT_POOL_INVOICE_NO = 'DEPOSIT_POOL';
export const UN_ASSOCIATED_POOL_INVOICE_NO = 'Un_Associated';
export const SYSTEM_POOL_INVOICE_NOS = new Set([DEPOSIT_POOL_INVOICE_NO, UN_ASSOCIATED_POOL_INVOICE_NO]);

export type PaymentTypeClassification = 'Initial' | 'Final' | 'Full payment' | 'Std' | 'Deposit';

export type PaymentTypeClassificationInput = {
  balanceAfter: number | null;
  isPoolOrder: boolean;
  isDepositPayment: boolean;
  isFirstPayment: boolean;
};

export function classifyPaymentType(input: PaymentTypeClassificationInput): PaymentTypeClassification {
  if (!input.isPoolOrder && typeof input.balanceAfter === 'number' && input.balanceAfter <= 5) {
    if (input.isFirstPayment && !input.isDepositPayment) {
      return 'Full payment';
    }
    return 'Final';
  }

  if (input.isFirstPayment) {
    if (input.isDepositPayment) {
      return 'Deposit';
    }
    return 'Initial';
  }

  return 'Std';
}

export function mapPaymentTypeClassificationToReceiptGenerator(type: PaymentTypeClassification): ReceiptGeneratorPaymentType {
  if (type === 'Full payment') return 'Full';
  if (type === 'Std') return 'Standard';
  return type;
}
