export type DetailEditableItemPatch = {
  mark: string | null;
  orderNo: string | null;
  amount: number;
  receiptId: string | null;
};

export type DetailEditablePatch = {
  date: string | null;
  agentId: string | null;
  items: DetailEditableItemPatch[];
};

export type DetailEditRequestRow = {
  id: string;
  detailId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  beforeSnapshot: DetailEditablePatch;
  afterSnapshot: DetailEditablePatch;
  reviewComment: string | null;
};
