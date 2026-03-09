export const IMPORT_RESULT_PAGE_SIZE = 50;

export type InvoiceImportIssueRow = {
  rowNo: number;
  invNo: string;
  shipDate: string;
  releaseDate: string;
  orderNo: string;
  amount: string;
  customerMark: string;
  customerName: string;
  customerId: string;
  reason: string;
};

export type InvoiceImportRowResult = Omit<InvoiceImportIssueRow, 'reason'> & {
  status: 'SUCCESS' | 'FAILED';
  reason: string;
};

export type InvoiceImportRowView = Omit<InvoiceImportIssueRow, 'reason'> & {
  latestStatus: 'SUCCESS' | 'FAILED';
  latestReason: string;
  attempts: Array<{ status: string; reason: string }>;
};

export function toInvoiceImportRowResults(raw: unknown): InvoiceImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      invNo: String(item.invNo || ''),
      shipDate: String(item.shipDate || ''),
      releaseDate: String(item.releaseDate || ''),
      orderNo: String(item.orderNo || ''),
      amount: String(item.amount || ''),
      customerMark: String(item.customerMark || ''),
      customerName: String(item.customerName || ''),
      customerId: String(item.customerId || ''),
      status: String(item.status || '').toUpperCase() === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function toInvoiceImportRowResultsFromIssues(raw: unknown): InvoiceImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      invNo: String(item.invNo || ''),
      shipDate: String(item.shipDate || ''),
      releaseDate: String(item.releaseDate || ''),
      orderNo: String(item.orderNo || ''),
      amount: String(item.amount || ''),
      customerMark: String(item.customerMark || ''),
      customerName: String(item.customerName || ''),
      customerId: String(item.customerId || ''),
      status: 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function initInvoiceImportRowViews(results: InvoiceImportRowResult[]): InvoiceImportRowView[] {
  return results
    .sort((a, b) => a.rowNo - b.rowNo)
    .map((row) => ({
      rowNo: row.rowNo,
      invNo: row.invNo,
      shipDate: row.shipDate,
      releaseDate: row.releaseDate,
      orderNo: row.orderNo,
      amount: row.amount,
      customerMark: row.customerMark,
      customerName: row.customerName,
      customerId: row.customerId,
      latestStatus: row.status,
      latestReason: row.reason,
      attempts: [{ status: row.status, reason: row.reason }],
    }));
}

export function mergeInvoiceImportRowViews(
  prev: InvoiceImportRowView[],
  retryResults: InvoiceImportRowResult[]
): InvoiceImportRowView[] {
  const byRowNo = new Map<number, InvoiceImportRowResult>();
  for (const row of retryResults) byRowNo.set(row.rowNo, row);

  const merged = prev.map((row) => {
    const next = byRowNo.get(row.rowNo);
    if (next) {
      return {
        rowNo: next.rowNo,
        invNo: next.invNo,
        shipDate: next.shipDate,
        releaseDate: next.releaseDate,
        orderNo: next.orderNo,
        amount: next.amount,
        customerMark: next.customerMark,
        customerName: next.customerName,
        customerId: next.customerId,
        latestStatus: next.status,
        latestReason: next.reason,
        attempts: [...row.attempts, { status: next.status, reason: next.reason }],
      };
    }
    const carryStatus = row.latestStatus === 'SUCCESS' ? 'SUCCEED' : 'NOT_RETRIED';
    return {
      ...row,
      attempts: [...row.attempts, { status: carryStatus, reason: row.latestReason }],
    };
  });

  const prevRowNos = new Set(prev.map((row) => row.rowNo));
  const attemptLength = merged[0]?.attempts.length || 1;
  for (const next of retryResults) {
    if (prevRowNos.has(next.rowNo)) continue;
    const fillerCount = Math.max(0, attemptLength - 1);
    merged.push({
      rowNo: next.rowNo,
      invNo: next.invNo,
      shipDate: next.shipDate,
      releaseDate: next.releaseDate,
      orderNo: next.orderNo,
      amount: next.amount,
      customerMark: next.customerMark,
      customerName: next.customerName,
      customerId: next.customerId,
      latestStatus: next.status,
      latestReason: next.reason,
      attempts: [
        ...Array.from({ length: fillerCount }, () => ({ status: 'SUCCEED', reason: '' })),
        { status: next.status, reason: next.reason },
      ],
    });
  }
  return merged.sort((a, b) => a.rowNo - b.rowNo);
}

export type CustomerImportIssueRow = {
  rowNo: number;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerEmail: string;
  reason: string;
};

export type CustomerImportRowResult = Omit<CustomerImportIssueRow, 'reason'> & {
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED';
  reason: string;
};

export type CustomerImportRowView = Omit<CustomerImportIssueRow, 'reason'> & {
  latestStatus: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED';
  latestReason: string;
  attempts: Array<{ status: string; reason: string }>;
};

export function toCustomerImportRowResults(raw: unknown): CustomerImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    const statusRaw = String(item.status || '').toUpperCase();
    const status = statusRaw === 'CREATED' || statusRaw === 'UPDATED' || statusRaw === 'UNCHANGED' || statusRaw === 'FAILED'
      ? statusRaw
      : 'FAILED';
    return {
      rowNo: Number(item.rowNo) || 0,
      mark: String(item.mark || ''),
      orderName: String(item.orderName || ''),
      name: String(item.name || ''),
      phone: String(item.phone || ''),
      city: String(item.city || ''),
      consignee: String(item.consignee || ''),
      companyName: String(item.companyName || ''),
      credit: String(item.credit || ''),
      companyAddress: String(item.companyAddress || ''),
      ownerEmail: String(item.ownerEmail || ''),
      status: status as CustomerImportRowResult['status'],
      reason: String(item.reason || ''),
    };
  });
}

export function toCustomerImportRowResultsFromIssues(raw: unknown): CustomerImportRowResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = (row && typeof row === 'object') ? (row as Record<string, unknown>) : {};
    return {
      rowNo: Number(item.rowNo) || 0,
      mark: String(item.mark || ''),
      orderName: String(item.orderName || ''),
      name: String(item.name || ''),
      phone: String(item.phone || ''),
      city: String(item.city || ''),
      consignee: String(item.consignee || ''),
      companyName: String(item.companyName || ''),
      credit: String(item.credit || ''),
      companyAddress: String(item.companyAddress || ''),
      ownerEmail: String(item.ownerEmail || ''),
      status: 'FAILED',
      reason: String(item.reason || ''),
    };
  });
}

export function initCustomerImportRowViews(results: CustomerImportRowResult[]): CustomerImportRowView[] {
  return results
    .sort((a, b) => a.rowNo - b.rowNo)
    .map((row) => ({
      rowNo: row.rowNo,
      mark: row.mark,
      orderName: row.orderName,
      name: row.name,
      phone: row.phone,
      city: row.city,
      consignee: row.consignee,
      companyName: row.companyName,
      credit: row.credit,
      companyAddress: row.companyAddress,
      ownerEmail: row.ownerEmail,
      latestStatus: row.status,
      latestReason: row.reason,
      attempts: [{ status: row.status, reason: row.reason }],
    }));
}

export function mergeCustomerImportRowViews(
  prev: CustomerImportRowView[],
  retryResults: CustomerImportRowResult[]
): CustomerImportRowView[] {
  const byRowNo = new Map<number, CustomerImportRowResult>();
  for (const row of retryResults) byRowNo.set(row.rowNo, row);

  const merged = prev.map((row) => {
    const next = byRowNo.get(row.rowNo);
    if (next) {
      return {
        rowNo: next.rowNo,
        mark: next.mark,
        orderName: next.orderName,
        name: next.name,
        phone: next.phone,
        city: next.city,
        consignee: next.consignee,
        companyName: next.companyName,
        credit: next.credit,
        companyAddress: next.companyAddress,
        ownerEmail: next.ownerEmail,
        latestStatus: next.status,
        latestReason: next.reason,
        attempts: [...row.attempts, { status: next.status, reason: next.reason }],
      };
    }
    const carryStatus = row.latestStatus !== 'FAILED' ? 'SUCCEED' : 'NOT_RETRIED';
    return {
      ...row,
      attempts: [...row.attempts, { status: carryStatus, reason: row.latestReason }],
    };
  });

  const prevRowNos = new Set(prev.map((row) => row.rowNo));
  const attemptLength = merged[0]?.attempts.length || 1;
  for (const next of retryResults) {
    if (prevRowNos.has(next.rowNo)) continue;
    const fillerCount = Math.max(0, attemptLength - 1);
    merged.push({
      rowNo: next.rowNo,
      mark: next.mark,
      orderName: next.orderName,
      name: next.name,
      phone: next.phone,
      city: next.city,
      consignee: next.consignee,
      companyName: next.companyName,
      credit: next.credit,
      companyAddress: next.companyAddress,
      ownerEmail: next.ownerEmail,
      latestStatus: next.status,
      latestReason: next.reason,
      attempts: [
        ...Array.from({ length: fillerCount }, () => ({ status: 'SUCCEED', reason: '' })),
        { status: next.status, reason: next.reason },
      ],
    });
  }
  return merged.sort((a, b) => a.rowNo - b.rowNo);
}
