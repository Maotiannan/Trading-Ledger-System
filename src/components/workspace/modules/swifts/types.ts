export type SwiftOcrResult = {
  amount?: number;
  date?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  receiverName?: string | null;
  receiverAccount?: string | null;
};

export type SwiftDirectForm = {
  detailId: string;
  amount: string;
  date: string;
  senderName: string;
  senderAddress: string;
  receiverName: string;
  receiverAccount: string;
};

export const EMPTY_SWIFT_DIRECT_FORM: SwiftDirectForm = {
  detailId: '',
  amount: '',
  date: '',
  senderName: '',
  senderAddress: '',
  receiverName: '',
  receiverAccount: '',
};
