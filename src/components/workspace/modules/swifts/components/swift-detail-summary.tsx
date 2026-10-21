import { formatUsdAmount } from '@/lib/display-format';
import type { SwiftDetailOption } from '../types';

export function swiftDetailOptionLabel(detail: SwiftDetailOption, tx: (zh: string, en: string) => string) {
  return `${detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')} - ${formatUsdAmount(detail.totalAmount)}`;
}

export function SwiftDetailSummary({ detail, tx }: { detail?: SwiftDetailOption; tx: (zh: string, en: string) => string }) {
  if (!detail) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
      <span>{tx('总计', 'Total')}: {formatUsdAmount(detail.totalAmount)}</span>
      <span>SWIFT: {formatUsdAmount(detail.transferSummary?.transferredAmount ?? 0)}</span>
      <span>{tx('余额', 'Balance')}: {formatUsdAmount(detail.transferSummary?.remainingAmount ?? detail.totalAmount)}</span>
    </div>
  );
}
