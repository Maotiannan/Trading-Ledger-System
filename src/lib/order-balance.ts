import { ReceiptStatus } from '@prisma/client';
import { addMoney, moneyToNumber, subtractMoney, type MoneyInput } from '@/lib/money';

export type OrderBalanceReceiptInput = {
  usd: MoneyInput;
  status?: ReceiptStatus | string | null;
  funding?: { id: string } | null;
};

export type OrderPaymentAllocationInput = {
  amount: MoneyInput;
  appliedAt?: Date | string | null;
  funding: { active: boolean; originalReceiptId?: string; receipt: {
    status?: ReceiptStatus | string | null; id?: string; createdAt?: Date | string;
  } | null };
};

export type ComputeOrderBalanceInput = {
  amount: MoneyInput;
  receipts?: OrderBalanceReceiptInput[] | null;
  paymentAllocations?: OrderPaymentAllocationInput[] | null;
};

export type OrderBalanceComparison = {
  matches: boolean;
  stored: number;
  computed: number;
  difference: number;
};

export function isReceiptIncludedInOrderBalance(status: ReceiptStatus | string | null | undefined): boolean {
  return status !== ReceiptStatus.SIGNING_PENDING;
}

export function normalizeOrderBalanceNumber(value: MoneyInput): number {
  return moneyToNumber(value);
}

export function computeOrderBalanceFromReceipts(input: ComputeOrderBalanceInput): number {
  const receiptTotal = addMoney((input.receipts || [])
    .filter((receipt) => !receipt.funding && isReceiptIncludedInOrderBalance(receipt.status))
    .map((receipt) => receipt.usd || 0));

  const allocated = addMoney((input.paymentAllocations || []).filter(row => row.funding.active
    && row.funding.receipt && isReceiptIncludedInOrderBalance(row.funding.receipt.status)).map(row => row.amount));
  return moneyToNumber(subtractMoney(input.amount || 0, addMoney([receiptTotal, allocated])));
}

export function compareStoredOrderBalance(input: { stored: MoneyInput; computed: MoneyInput }): OrderBalanceComparison {
  const stored = normalizeOrderBalanceNumber(input.stored || 0);
  const computed = normalizeOrderBalanceNumber(input.computed || 0);
  const difference = normalizeOrderBalanceNumber(computed - stored);

  return {
    matches: Math.abs(difference) < 0.005,
    stored,
    computed,
    difference,
  };
}
