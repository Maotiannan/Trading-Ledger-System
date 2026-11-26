export type DepositPoolRow = {
  id: string; kind: 'LEGACY' | 'CREDIT'; orderId: string | null; orderNo: string; customerLabel: string;
  creditId: string | null; receiptNo: string | null; availableAmount: string; usedAmount: string; reservedAmount: string;
  held: boolean; heldAmount: string; pendingSignature: boolean; active: boolean; legacyBalance: number | null;
};
export type DepositPool = {
  rows: DepositPoolRow[]; availableTotal: string; reservedTotal: string; heldTotal: string;
};
export function isActivePoolRow(row: DepositPoolRow) {
  return Number(row.availableAmount) > 0 || Number(row.reservedAmount) > 0 || row.held || row.pendingSignature;
}

export function activePoolRowCount(rows: DepositPoolRow[]) {
  return rows.filter(isActivePoolRow).length;
}
