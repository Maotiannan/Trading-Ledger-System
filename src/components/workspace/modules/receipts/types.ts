export type ReceiptDirectForm = {
  receiptNo: string;
  date: string;
  tel: string;
  usd: string;
  invNo: string;
  orderNo: string;
  payer: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  isDeposit: boolean;
};

export type DirectImageUploadStatus = 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed';

export type PendingDirectImageSelection = {
  file: File;
  previewUrl: string;
  name: string;
};

export const EMPTY_RECEIPT_DIRECT_FORM: ReceiptDirectForm = {
  receiptNo: '',
  date: '',
  tel: '',
  usd: '',
  invNo: '',
  orderNo: '',
  payer: '',
  customerMark: '',
  customerName: '',
  customerId: '',
  isDeposit: false,
};
