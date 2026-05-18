export type OrderTrackerRow = {
  id: string;
  orderNo: string;
  status: string;
  piStatus: boolean;
  remark: string | null;
  systemNote: string | null;
  customerId: string | null;
  customerMark: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  financeOrderId?: string | null;
  financeOrderNo?: string | null;
  financeInvNo?: string | null;
  depositAmount: number;
  canEdit: boolean;
  canEditAdminFields: boolean;
  createdAt: string;
  creator?: { id: string; email: string; name: string | null; role: string } | null;
};

export type OrderTrackerCustomerOption = {
  id: string;
  mark: string;
  orderName: string;
  name: string;
  companyName: string | null;
  phone: string;
  city: string;
  ownerId: string;
  label: string;
};
