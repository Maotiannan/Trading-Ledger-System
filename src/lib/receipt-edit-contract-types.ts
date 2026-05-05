/**
 * Shared API/contract shapes for receipt edit requests.
 * Keep these transport-facing types separate from Prisma row assumptions.
 */
export type ReceiptEditablePatch = {
  receiptNo: string | null;
  date: string | null;
  invNo: string | null;
  customerMark: string | null;
  payer: string | null;
  tel: string | null;
};

export type ReceiptEditRequestRow = {
  id: string;
  receiptId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  beforeSnapshot: ReceiptEditablePatch;
  afterSnapshot: ReceiptEditablePatch;
  reviewComment: string | null;
};
