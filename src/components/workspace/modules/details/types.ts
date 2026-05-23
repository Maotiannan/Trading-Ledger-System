export type DetailDirectItemForm = {
  mark: string;
  orderNo: string;
  amount: string;
};

export type DetailDirectSelectableReceipt = {
  id: string;
  receiptNo: string | null;
  date: string | null;
  usd: number;
  orderNo: string | null;
  payer: string | null;
  customerMark?: string | null;
  customerName?: string | null;
  status: string;
  order?: {
    orderNo?: string | null;
    customerMark?: string | null;
    customerName?: string | null;
  } | null;
};

export type DetailImageUploadStatus = 'idle' | 'compressing' | 'uploading' | 'saving' | 'success' | 'failed';

export type DetailOcrUploadStatus = DetailImageUploadStatus;

export type DetailOcrResult = {
  date: string | null;
  agentId?: string | null;
  items: Array<{
    mark: string | null;
    orderNo: string | null;
    amount: number;
    matchedReceiptId?: string | null;
  }>;
};

export type PaymentAgentFileSummary = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type PaymentAgentSummary = {
  id: string;
  companyName: string;
  companyAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  files: PaymentAgentFileSummary[];
};

export const EMPTY_DETAIL_DIRECT_ITEM: DetailDirectItemForm = {
  mark: '',
  orderNo: '',
  amount: '',
};
