export type SwiftOcrResult = {
  amount?: number | null;
  date?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  receiverName?: string | null;
  receiverAccount?: string | null;
};

export type SwiftImageUploadStatus = 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed';

export type SwiftOcrUploadStatus = SwiftImageUploadStatus;

export type SwiftDetailOption = {
  id: string;
  date: string | null;
  totalAmount: number;
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
