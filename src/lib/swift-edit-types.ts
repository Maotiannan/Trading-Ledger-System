export type SwiftEditablePatch = {
  date: string | null;
  amount: number;
  senderName: string | null;
  senderAddress: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
};

export type SwiftEditRequestRow = {
  id: string;
  swiftId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  requestedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  beforeSnapshot: SwiftEditablePatch;
  afterSnapshot: SwiftEditablePatch;
  reviewComment: string | null;
};
