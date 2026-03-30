'use client';

import { useCallback } from 'react';
import {
  apiCall,
  getApiErrorMessage,
  getApiResponseErrorMessage,
  getErrorMessage,
  initCustomerImportRowViews,
  mergeCustomerImportRowViews,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  type CustomerImportRowView,
} from '@/components/workspace/shared';
import type { CustomerFormState } from '../types';
import type { CustomerFixTarget } from './use-customer-forms';

export type CustomerActionText = (zh: string, en: string) => string;

export type CustomerActionDeps = {
  tx: CustomerActionText;
  isAdmin: boolean;
  defaultOwnerId: string;
  importOwnerId: string;
  editing: Record<string, unknown> | null;
  fixingTarget: CustomerFixTarget;
  form: CustomerFormState;
  latestFailedRows: CustomerImportRowView[];
  loadCustomers: () => Promise<void>;
  loadFixes: () => Promise<void>;
  setOwnerOptions: (options: Array<{ id: string; email: string; name: string | null; role: string; level: number }>) => void;
  setImportOwnerId: (value: string | ((prev: string) => string)) => void;
  setForm: React.Dispatch<React.SetStateAction<CustomerFormState>>;
  setShowCreate: (open: boolean) => void;
  setEditing: (value: Record<string, unknown> | null) => void;
  setFixingTarget: (value: CustomerFixTarget) => void;
  setCustomerImporting: (value: boolean) => void;
  setCustomerImportRows: React.Dispatch<React.SetStateAction<CustomerImportRowView[]>>;
  setShowCustomerImportIssues: (value: boolean) => void;
  setCustomerIssueSubmitting: (value: boolean) => void;
  setCustomerImportMessage: (value: string) => void;
  customerImportInputRef: React.RefObject<HTMLInputElement | null>;
  resetForm: () => void;
  resetImportTable: () => void;
};

export function useCustomerActions({
  tx,
  isAdmin,
  defaultOwnerId,
  importOwnerId,
  editing,
  fixingTarget,
  form,
  latestFailedRows,
  loadCustomers,
  loadFixes,
  setOwnerOptions,
  setImportOwnerId,
  setForm,
  setShowCreate,
  setEditing,
  setFixingTarget,
  setCustomerImporting,
  setCustomerImportRows,
  setShowCustomerImportIssues,
  setCustomerIssueSubmitting,
  setCustomerImportMessage,
  customerImportInputRef,
  resetForm,
  resetImportTable,
}: CustomerActionDeps) {
  const loadOwnerOptions = useCallback(async () => {
    const result = await apiCall('customer?action=owner-options');
    if (!result.success) return;
    const options = Array.isArray(result.data) ? result.data : [];
    setOwnerOptions(options);

    if (isAdmin) {
      const preferredSales = options.find((row) => row && row.role === 'SALES');
      const fallback = preferredSales?.id || options[0]?.id || defaultOwnerId;
      setImportOwnerId((prev) => prev || fallback);
      setForm((prev) => ({ ...prev, ownerId: prev.ownerId || fallback }));
    } else {
      setImportOwnerId(defaultOwnerId);
      setForm((prev) => ({ ...prev, ownerId: defaultOwnerId }));
    }
  }, [defaultOwnerId, isAdmin, setForm, setImportOwnerId, setOwnerOptions]);

  const handleCreateOrUpdate = useCallback(async () => {
    try {
      const payload = {
        ...(editing ? { action: 'update', id: editing.id } : { action: 'create' }),
        mark: form.mark,
        orderName: form.orderName,
        name: form.name,
        phone: form.phone,
        city: form.city,
        consignee: form.consignee,
        companyName: form.companyName || null,
        companyAddress: form.companyAddress || null,
        credit: form.credit === '' ? null : Number(form.credit),
        ownerId: isAdmin ? (form.ownerId || importOwnerId || defaultOwnerId) : defaultOwnerId,
      };
      const result = await apiCall('customer', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.success) {
        alert(getErrorMessage(result, tx('保存失败', 'Save failed')));
        return;
      }
      setShowCreate(false);
      setEditing(null);
      resetForm();
      await loadCustomers();
      if (result.data?.phoneConflict) {
        alert(tx('手机号冲突，请修改', 'Phone number conflict, please update it.'));
      }
    } catch (error) {
      alert(getErrorMessage(error, tx('保存失败', 'Save failed')));
    }
  }, [defaultOwnerId, editing, form, importOwnerId, isAdmin, loadCustomers, resetForm, setEditing, setShowCreate, tx]);

  const handleDelete = useCallback(async (id: string) => {
    if (!isAdmin) return;
    if (!confirm(tx('确定删除该客户吗？', 'Delete this customer?'))) return;
    try {
      const result = await apiCall('customer', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      if (!result.success) {
        alert(getErrorMessage(result, tx('删除失败', 'Delete failed')));
        return;
      }
      await loadCustomers();
    } catch (error) {
      alert(getErrorMessage(error, tx('删除失败', 'Delete failed')));
    }
  }, [isAdmin, loadCustomers, tx]);

  const submitFix = useCallback(async () => {
    if (!fixingTarget) return;
    try {
      const payload = {
        action: fixingTarget.type === 'order' ? 'resolve-order' : 'resolve-receipt',
        ...(fixingTarget.type === 'order' ? { orderId: fixingTarget.id } : { receiptId: fixingTarget.id }),
        mark: form.mark,
        orderName: form.orderName,
        name: form.name,
        phone: form.phone,
        city: form.city,
        consignee: form.consignee,
        companyName: form.companyName || null,
        companyAddress: form.companyAddress || null,
        credit: form.credit === '' ? null : Number(form.credit),
        ownerId: isAdmin ? (form.ownerId || importOwnerId || defaultOwnerId) : defaultOwnerId,
      };
      const result = await apiCall('customer/fixes', { method: 'POST', body: JSON.stringify(payload) });
      if (!result.success) {
        alert(getErrorMessage(result, tx('修复失败', 'Fix failed')));
        return;
      }
      setFixingTarget(null);
      resetForm();
      await loadCustomers();
      await loadFixes();
    } catch (error) {
      alert(getErrorMessage(error, tx('修复失败', 'Fix failed')));
    }
  }, [defaultOwnerId, fixingTarget, form, importOwnerId, isAdmin, loadCustomers, loadFixes, resetForm, setFixingTarget, tx]);

  const downloadCustomerImportTemplate = useCallback(async () => {
    try {
      const response = await fetch('/api/customer?action=import-template', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(await getApiResponseErrorMessage(response, tx('模板下载失败', 'Failed to download template')));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'customer-import-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('模板下载失败', 'Failed to download template'));
    }
  }, [tx]);

  const handleCustomerExcelImport = useCallback(async (file: File) => {
    setCustomerImporting(true);
    try {
      const formData = new FormData();
      formData.append('action', 'import-excel');
      if (isAdmin && (importOwnerId || defaultOwnerId)) {
        formData.append('ownerId', importOwnerId || defaultOwnerId);
      }
      formData.append('file', file);
      const response = await fetch('/api/customer', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(result?.rowResults) && !Array.isArray(result?.issueRows)) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${getErrorMessage(result, tx('导入失败', 'Import failed'))}${details}`);
      }

      const rowResults = toCustomerImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toCustomerImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${getErrorMessage(result, tx('导入失败', 'Import failed'))}${details}`);
      }
      setCustomerImportRows(initCustomerImportRowViews(fallbackResults));
      resetImportTable();
      setCustomerImportMessage(String(result?.message || getApiErrorMessage(result, tx('导入完成', 'Import completed'))));
      setShowCustomerImportIssues(true);
      await loadCustomers();
    } catch (error) {
      alert(getErrorMessage(error, tx('导入失败', 'Import failed')));
    } finally {
      setCustomerImporting(false);
      if (customerImportInputRef.current) customerImportInputRef.current.value = '';
    }
  }, [
    customerImportInputRef,
    defaultOwnerId,
    importOwnerId,
    isAdmin,
    loadCustomers,
    resetImportTable,
    setCustomerImportMessage,
    setCustomerImportRows,
    setCustomerImporting,
    setShowCustomerImportIssues,
    tx,
  ]);

  const retryCustomerIssueRows = useCallback(async () => {
    if (latestFailedRows.length === 0) return;
    setCustomerIssueSubmitting(true);
    try {
      const response = await fetch('/api/customer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import-rows',
          ownerId: isAdmin ? (importOwnerId || defaultOwnerId) : defaultOwnerId,
          rows: latestFailedRows.map((row) => ({
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
          })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(result?.rowResults) && !Array.isArray(result?.issueRows)) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${getErrorMessage(result, tx('导入失败', 'Import failed'))}${details}`);
      }
      const rowResults = toCustomerImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toCustomerImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${getErrorMessage(result, tx('导入失败', 'Import failed'))}${details}`);
      }
      setCustomerImportRows((prev) => mergeCustomerImportRowViews(prev, fallbackResults));
      setCustomerImportMessage(String(result?.message || getApiErrorMessage(result, tx('重试完成', 'Retry completed'))));
      await loadCustomers();
    } catch (error) {
      alert(getErrorMessage(error, tx('导入失败', 'Import failed')));
    } finally {
      setCustomerIssueSubmitting(false);
    }
  }, [
    defaultOwnerId,
    importOwnerId,
    isAdmin,
    latestFailedRows,
    loadCustomers,
    setCustomerImportMessage,
    setCustomerImportRows,
    setCustomerIssueSubmitting,
    tx,
  ]);

  return {
    loadOwnerOptions,
    handleCreateOrUpdate,
    handleDelete,
    submitFix,
    downloadCustomerImportTemplate,
    handleCustomerExcelImport,
    retryCustomerIssueRows,
  };
}
