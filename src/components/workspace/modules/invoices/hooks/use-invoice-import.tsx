'use client';

import { useMemo, useState, type MutableRefObject } from 'react';
import { Input } from '@/components/ui/input';
import {
  initInvoiceImportRowViews,
  mergeInvoiceImportRowViews,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import { useImportResultTable } from '@/components/workspace/hooks';
import type { ImportResultDialogColumn } from '@/components/workspace/components/import-result-dialog';

export type InvoiceImportText = (zh: string, en: string) => string;

export function useInvoiceImport(
  tx: InvoiceImportText,
  loadInvoices: () => Promise<void>,
  inputRef: MutableRefObject<HTMLInputElement | null>,
) {
  const [invoiceImporting, setInvoiceImporting] = useState(false);
  const [invoiceImportRows, setInvoiceImportRows] = useState<InvoiceImportRowView[]>([]);
  const [showInvoiceImportIssues, setShowInvoiceImportIssues] = useState(false);
  const [invoiceIssueSubmitting, setInvoiceIssueSubmitting] = useState(false);
  const [invoiceImportMessage, setInvoiceImportMessage] = useState('');
  const invoiceImportTable = useImportResultTable(invoiceImportRows);

  const updateInvoiceImportIssue = (rowNo: number, field: keyof Omit<InvoiceImportRowView, 'latestStatus' | 'latestReason' | 'attempts'>, value: string) => {
    setInvoiceImportRows((prev) => prev.map((row) => {
      if (row.rowNo !== rowNo || row.latestStatus !== 'FAILED') return row;
      return { ...row, [field]: value };
    }));
  };

  const handleInvoiceExcelImport = async (file: File) => {
    setInvoiceImporting(true);
    try {
      const formData = new FormData();
      formData.append('action', 'import-excel');
      formData.append('file', file);
      const response = await fetch('/api/invoice', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(result?.rowResults) && !Array.isArray(result?.issueRows)) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }

      const rowResults = toInvoiceImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toInvoiceImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      setInvoiceImportRows(initInvoiceImportRowViews(fallbackResults));
      invoiceImportTable.reset();
      setInvoiceImportMessage(String(result?.message || result?.error || tx('导入完成', 'Import completed')));
      setShowInvoiceImportIssues(true);
      await loadInvoices();
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('导入失败', 'Import failed'));
    } finally {
      setInvoiceImporting(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const retryInvoiceIssueRows = async () => {
    if (invoiceImportTable.latestFailedRows.length === 0) return;
    setInvoiceIssueSubmitting(true);
    try {
      const response = await fetch('/api/invoice', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import-rows',
          rows: invoiceImportTable.latestFailedRows.map((row) => ({
            rowNo: row.rowNo,
            invNo: row.invNo,
            shipDate: row.shipDate,
            releaseDate: row.releaseDate,
            orderNo: row.orderNo,
            amount: row.amount,
            customerMark: row.customerMark,
            customerName: row.customerName,
            customerId: row.customerId,
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(result?.rowResults) && !Array.isArray(result?.issueRows)) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      const rowResults = toInvoiceImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toInvoiceImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      setInvoiceImportRows((prev) => mergeInvoiceImportRowViews(prev, fallbackResults));
      setInvoiceImportMessage(String(result?.message || tx('重试完成', 'Retry completed')));
      await loadInvoices();
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('导入失败', 'Import failed'));
    } finally {
      setInvoiceIssueSubmitting(false);
    }
  };

  const closeInvoiceImportDialog = () => {
    setShowInvoiceImportIssues(false);
    setInvoiceImportRows([]);
    setInvoiceImportMessage('');
    invoiceImportTable.reset();
  };

  const invoiceImportColumns: ImportResultDialogColumn<InvoiceImportRowView>[] = useMemo(() => ([
    {
      key: 'invNo',
      header: 'INV_NO',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.invNo} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'invNo', e.target.value)} />
      ),
    },
    {
      key: 'orderNo',
      header: 'ORDER_NO',
      className: 'min-w-[300px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[300px]" value={row.orderNo} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'orderNo', e.target.value)} />
      ),
    },
    {
      key: 'amount',
      header: 'AMOUNT',
      className: 'min-w-[140px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[140px]" value={row.amount} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'amount', e.target.value)} />
      ),
    },
    {
      key: 'customerMark',
      header: 'CUSTOMER_MARK',
      className: 'min-w-[280px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[280px]" value={row.customerMark} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'customerMark', e.target.value)} />
      ),
    },
    {
      key: 'customerName',
      header: 'CUSTOMER_ORDER_NAME',
      className: 'min-w-[320px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[320px]" value={row.customerName} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'customerName', e.target.value)} />
      ),
    },
    {
      key: 'shipDate',
      header: 'SHIP_DATE',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.shipDate} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'shipDate', e.target.value)} />
      ),
    },
    {
      key: 'releaseDate',
      header: 'RELEASE_DATE',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.releaseDate} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'releaseDate', e.target.value)} />
      ),
    },
  ]), []);

  return {
    invoiceImporting,
    showInvoiceImportIssues,
    setShowInvoiceImportIssues,
    invoiceIssueSubmitting,
    invoiceImportMessage,
    invoiceImportTable,
    invoiceImportColumns,
    handleInvoiceExcelImport,
    retryInvoiceIssueRows,
    closeInvoiceImportDialog,
  };
}
