import type { Invoice } from '@/lib/store';

function getSpecialPoolRank(invNo: string): number {
  const normalized = String(invNo || '').trim().toUpperCase();
  if (normalized === 'DEPOSIT_POOL') return 0;
  if (normalized === 'UN_ASSOCIATED') return 1;
  return 2;
}

function parseShipDateWeight(shipDate: string | null | undefined): number {
  if (!shipDate) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(shipDate);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function orderInvoicesForDisplay(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((left, right) => {
    const leftPoolRank = getSpecialPoolRank(left.invNo);
    const rightPoolRank = getSpecialPoolRank(right.invNo);
    if (leftPoolRank !== rightPoolRank) return leftPoolRank - rightPoolRank;
    if (leftPoolRank < 2) {
      return left.invNo.localeCompare(right.invNo);
    }

    const leftCompleted = left.invBalance <= 0 ? 1 : 0;
    const rightCompleted = right.invBalance <= 0 ? 1 : 0;
    if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;

    const leftShipWeight = parseShipDateWeight(left.shipDate);
    const rightShipWeight = parseShipDateWeight(right.shipDate);
    if (leftShipWeight !== rightShipWeight) return leftShipWeight - rightShipWeight;

    return left.invNo.localeCompare(right.invNo);
  });
}
