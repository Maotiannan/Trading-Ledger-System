// Status eligibility only. Ownership, role, transfer lineage and locks remain server checks.
export const canEditPaymentDetailStatus = (status: string) => status !== 'RECEIVED';
export const canDeletePaymentDetailStatus = (status: string) =>
  canEditPaymentDetailStatus(status) && status !== 'Bank_Transfer';
export const canEditSwiftStatus = (status: string, detailStatus?: string) =>
  status !== 'RECEIVED' && detailStatus !== 'RECEIVED';
export const canEditReceiptStatus = (status: string) => status !== 'Bank_Transfer';
