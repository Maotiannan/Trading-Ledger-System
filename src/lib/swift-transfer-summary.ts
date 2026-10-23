import { addMoney, moneyToNumber, toDecimal, type MoneyInput } from '@/lib/money';

export type SwiftTransferInput = {
  amount: MoneyInput;
  status?: string;
  hasError?: boolean;
};

export function calculateSwiftTransferSummary(
  detailAmount: MoneyInput,
  swifts: readonly SwiftTransferInput[],
  maxFeePerCopy = 40,
) {
  const valid = swifts.filter((swift) =>
    !swift.hasError && (swift.status === 'Bank_Transfer' || swift.status === 'RECEIVED'));
  const total = toDecimal(detailAmount);
  const transferred = addMoney(valid.map((swift) => swift.amount));
  const difference = total.minus(transferred);
  const feeTolerance = toDecimal(maxFeePerCopy).times(valid.length);
  const allReceived = valid.length > 0 && valid.every((swift) => swift.status === 'RECEIVED');
  const isOverpaid = difference.lt(0);
  const isCovered = total.gt(0) && valid.length > 0 && !isOverpaid && difference.lte(feeTolerance);
  const isComplete = isCovered && allReceived;
  return {
    transferredAmount: moneyToNumber(transferred),
    remainingAmount: moneyToNumber(difference.gt(0) ? difference : 0),
    validSwiftCount: valid.length,
    feeTolerance: moneyToNumber(feeTolerance),
    allReceived,
    isOverpaid,
    isComplete,
    status: isOverpaid ? 'ERROR' as const : isComplete ? 'RECEIVED' as const
      : isCovered ? 'Bank_Transfer' as const : 'Waiting_SWIFT' as const,
    swiftStatuses: valid.map((swift) => swift.status!),
  };
}
