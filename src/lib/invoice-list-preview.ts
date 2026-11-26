import type { Invoice } from '@/lib/store';

// Shared previews outlive the invoice view. Only a fresh, viewer-specific response may show this field.
export function invoiceListPreview(rows: Invoice[]): Invoice[] {
  return rows.map(row => {
    if (!row.source || !('creditInsurance' in row.source)) return row;
    const { creditInsurance: _heading, ...source } = row.source;
    return { ...row, source };
  });
}
