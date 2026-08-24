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
  invNo: string;
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

export type BranchAdminOption = {
  id: string;
  email: string;
  name: string | null;
  level?: number;
  parentId?: string | null;
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

export type SystemPoolRepairPreview = {
  sourceOrderId: string;
  orderNo: string;
  sourcePool: 'DEPOSIT_POOL' | 'Un_Associated';
  amount: number;
  orderBalance: number;
  receiptCount: number;
  repairMode: 'AUTO' | 'MANUAL';
  targetOrderId: string | null;
  targetInvoiceId: string | null;
  targetInvNo: string | null;
};

export type RematchTargetInvoice = {
  id: string;
  invNo: string;
};
