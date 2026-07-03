import { ReceiptStatus } from '@prisma/client';
import {
  compareStoredOrderBalance,
  computeOrderBalanceFromReceipts,
  isReceiptIncludedInOrderBalance,
  normalizeOrderBalanceNumber,
} from './order-balance';

describe('order-balance kernel', () => {
  it('computes live balance from order amount and non-pending receipts', () => {
    expect(computeOrderBalanceFromReceipts({
      amount: 28674,
      receipts: [
        { usd: 10000, status: ReceiptStatus.RECEIVED },
        { usd: 15000, status: ReceiptStatus.SR_Received },
      ],
    })).toBe(3674);
  });

  it('does not deduct SIGNING_PENDING receipts', () => {
    expect(computeOrderBalanceFromReceipts({
      amount: 1000,
      receipts: [
        { usd: 400, status: ReceiptStatus.SIGNING_PENDING },
        { usd: 100, status: ReceiptStatus.SR_Received },
      ],
    })).toBe(900);
  });

  it.each([
    ReceiptStatus.SR_Received,
    ReceiptStatus.Waiting_SWIFT,
    ReceiptStatus.Bank_Transfer,
    ReceiptStatus.RECEIVED,
  ])('deducts %s receipts', (status) => {
    expect(isReceiptIncludedInOrderBalance(status)).toBe(true);
    expect(computeOrderBalanceFromReceipts({
      amount: 1000,
      receipts: [{ usd: 250, status }],
    })).toBe(750);
  });

  it('normalizes and compares stored cache at cent precision', () => {
    expect(normalizeOrderBalanceNumber('123.456')).toBe(123.46);
    expect(compareStoredOrderBalance({ stored: 100.004, computed: 100 })).toEqual({
      matches: true,
      stored: 100,
      computed: 100,
      difference: 0,
    });
    expect(compareStoredOrderBalance({ stored: 38674, computed: 3674 })).toEqual({
      matches: false,
      stored: 38674,
      computed: 3674,
      difference: -35000,
    });
  });
});
