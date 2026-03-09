import type { CustomerCandidate } from '@/components/workspace/shared';

export type InvoiceDraftOrder = {
  orderNo: string;
  amount: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  customerCandidates: CustomerCandidate[];
};

export type EditingInvoiceOrder = {
  id: string;
  orderNo: string;
  amount: number;
  invoiceId: string;
  customerMark: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerId: string;
};

export type TransferFromOrder = {
  id: string;
  orderNo: string;
  balance: number;
};

export type RematchPreviewGroup = {
  groupId: string;
  groupType: 'exact' | 'customer-group';
  groupKey: string;
  orders: Array<{
    id: string;
    invNo: string;
    orderNo: string;
    amount: number;
    orderBalance: number;
    receiptCount: number;
    createdAt: string;
  }>;
};

export type RematchSelection = {
  keepOrderId: string;
  mode: 'keep' | 'merge';
  orderIds: string[];
};
