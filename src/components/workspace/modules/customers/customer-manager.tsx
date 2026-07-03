'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  apiCall,
  apiUploadCall,
  getApiErrorMessage,
  getErrorMessage,
  peekPrefetchedApiResult,
  rememberPrefetchedApiResult,
  useLatestRequestGuard,
  useUiText,
} from '@/components/workspace/shared';
import { ImportResultDialog } from '@/components/workspace/components/import-result-dialog';
import { useImportResultTable } from '@/components/workspace/hooks';
import {
  CustomerFixDialog,
  CustomerFixQueue,
  CustomerConsigneeDialog,
  CustomerFormDialog,
  CustomerList,
  CustomerLongTextPreviewDialog,
  CustomerOrderHistoryDialog,
  CustomerToolbar,
  type CustomerConsigneeItem,
  type CustomerOrderHistory,
} from './components';
import type { CustomerOwnerOption } from './types';
import type { CustomerCompanyFileOverwriteProposal, CustomerCompanyFileSummary } from './types';
import { useCustomerActions, useCustomerForms, useCustomerImportColumns } from './hooks';
import { useListPageSizePreference } from '@/components/workspace/modules/shared/use-list-page-size-preference';

function normalizePhoneToken(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitPhoneTokens(value: unknown): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return Array.from(new Set(raw.split('/').map((part) => normalizePhoneToken(part)).filter(Boolean)));
}

export function CustomerManager() {
  const tx = useUiText();
  const { user } = useStore();
  const isAdmin = user?.role === 'ADMIN';
  const defaultOwnerId = isAdmin ? (user?.id || '') : (user?.id || '');
  const [customers, setCustomers] = useState<Array<Record<string, unknown>>>([]);
  const [ownerOptions, setOwnerOptions] = useState<CustomerOwnerOption[]>([]);
  const [importOwnerId, setImportOwnerId] = useState('');
  const [fixOrders, setFixOrders] = useState<Array<Record<string, unknown>>>([]);
  const [fixReceipts, setFixReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [fixCustomerSearch, setFixCustomerSearch] = useState('');
  const [fixCustomerOptions, setFixCustomerOptions] = useState<Array<Record<string, unknown>>>([]);
  const [fixExistingCustomerId, setFixExistingCustomerId] = useState('');
  const [fixCustomerSearching, setFixCustomerSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [orderHistoryLoading, setOrderHistoryLoading] = useState(false);
  const [orderHistoryError, setOrderHistoryError] = useState('');
  const [orderHistoryTitle, setOrderHistoryTitle] = useState('');
  const [orderHistory, setOrderHistory] = useState<CustomerOrderHistory | null>(null);
  const [orderHistoryTarget, setOrderHistoryTarget] = useState<{ customerId: string; orderName: string } | null>(null);
  const [consigneeDialogCustomer, setConsigneeDialogCustomer] = useState<Record<string, unknown> | null>(null);
  const [consigneeRows, setConsigneeRows] = useState<CustomerConsigneeItem[]>([]);
  const [consigneeInput, setConsigneeInput] = useState('');
  const [consigneeLoading, setConsigneeLoading] = useState(false);
  const [consigneeSubmitting, setConsigneeSubmitting] = useState(false);
  const [consigneeError, setConsigneeError] = useState('');
  const [companyFiles, setCompanyFiles] = useState<CustomerCompanyFileSummary[]>([]);
  const [companyFileUploading, setCompanyFileUploading] = useState(false);
  const [companyFileError, setCompanyFileError] = useState('');
  const [companyFileProposal, setCompanyFileProposal] = useState<CustomerCompanyFileOverwriteProposal | null>(null);
  const customerRequestGuard = useLatestRequestGuard();
  const orderHistoryRequestGuard = useLatestRequestGuard();
  const {
    pageSize: orderHistoryOrderPageSize,
    pageSizeOptions: orderHistoryOrderPageSizeOptions,
    savePageSize: saveOrderHistoryOrderPageSize,
  } = useListPageSizePreference('customerHistoryOrders');
  const {
    pageSize: orderHistoryReceiptPageSize,
    pageSizeOptions: orderHistoryReceiptPageSizeOptions,
    savePageSize: saveOrderHistoryReceiptPageSize,
  } = useListPageSizePreference('customerHistoryReceipts');
  const {
    customerImportInputRef,
    showCreate,
    setShowCreate,
    editing,
    setEditing,
    fixingTarget,
    setFixingTarget,
    customerImporting,
    setCustomerImporting,
    customerImportRows,
    setCustomerImportRows,
    showCustomerImportIssues,
    setShowCustomerImportIssues,
    customerIssueSubmitting,
    setCustomerIssueSubmitting,
    customerImportMessage,
    setCustomerImportMessage,
    customerLongTextPreview,
    setCustomerLongTextPreview,
    form,
    setForm,
    resetForm,
    openEdit,
    openFix,
    closeCustomerImportDialog,
    updateCustomerImportIssue,
  } = useCustomerForms({ isAdmin, defaultOwnerId, importOwnerId });
  const customerImportTable = useImportResultTable(customerImportRows);
  const customerImportColumns = useCustomerImportColumns(updateCustomerImportIssue);

  const loadCustomers = useCallback(async (searchOverride?: string) => {
    const requestToken = customerRequestGuard.nextToken();
    const trimmedSearch = (searchOverride ?? search).trim();
    const endpoint = `customer${trimmedSearch ? `?search=${encodeURIComponent(trimmedSearch)}` : ''}`;
    const cachedResult = trimmedSearch ? null : peekPrefetchedApiResult<{ success?: boolean; data?: Array<Record<string, unknown>> }>(endpoint);
    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      if (customerRequestGuard.isLatest(requestToken)) {
        setCustomers(cachedResult.data);
      }
    }
    const result = await apiCall(endpoint);
    if (!customerRequestGuard.isLatest(requestToken)) return;
    if (result.success) setCustomers(Array.isArray(result.data) ? result.data : []);
    if (result.success && !trimmedSearch) {
      rememberPrefetchedApiResult(endpoint, result);
    }
  }, [customerRequestGuard, search]);

  const loadFixes = useCallback(async () => {
    const endpoint = 'customer/fixes';
    const cachedResult = peekPrefetchedApiResult<{ success?: boolean; data?: { orders?: Array<Record<string, unknown>>; receipts?: Array<Record<string, unknown>> } }>(endpoint);
    if (cachedResult?.success && cachedResult.data) {
      setFixOrders(Array.isArray(cachedResult.data.orders) ? cachedResult.data.orders : []);
      setFixReceipts(Array.isArray(cachedResult.data.receipts) ? cachedResult.data.receipts : []);
    }
    const result = await apiCall(endpoint);
    if (result.success && result.data) {
      setFixOrders(Array.isArray(result.data.orders) ? result.data.orders : []);
      setFixReceipts(Array.isArray(result.data.receipts) ? result.data.receipts : []);
      rememberPrefetchedApiResult(endpoint, result);
    }
  }, []);

  const {
    loadOwnerOptions,
    handleCreateOrUpdate,
    handleDelete,
    submitFix,
    downloadCustomerImportTemplate,
    handleCustomerExcelImport,
    retryCustomerIssueRows,
  } = useCustomerActions({
    tx,
    isAdmin,
    defaultOwnerId,
    importOwnerId,
    editing,
    fixingTarget,
    fixExistingCustomerId,
    form,
    latestFailedRows: customerImportTable.latestFailedRows,
    loadCustomers,
    loadFixes,
    setOwnerOptions,
    setImportOwnerId,
    setForm,
    setShowCreate,
    setEditing,
    setFixingTarget,
    setFixExistingCustomerId,
    setCustomerImporting,
    setCustomerImportRows,
    setShowCustomerImportIssues,
    setCustomerIssueSubmitting,
    setCustomerImportMessage,
    customerImportInputRef,
    resetForm,
    resetImportTable: customerImportTable.reset,
  });

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadCustomers();
      void loadFixes();
      void loadOwnerOptions();
    });
  }, [loadCustomers, loadFixes, loadOwnerOptions]);

  useEffect(() => {
    if (!fixingTarget) {
      return undefined;
    }
    const query = fixCustomerSearch.trim();
    if (!query) {
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFixCustomerSearching(true);
      void apiCall(`customer?search=${encodeURIComponent(query)}`)
        .then((result) => {
          if (cancelled) return;
          setFixCustomerOptions(result.success && Array.isArray(result.data) ? result.data.slice(0, 10) : []);
        })
        .catch(() => {
          if (!cancelled) setFixCustomerOptions([]);
        })
        .finally(() => {
          if (!cancelled) setFixCustomerSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fixCustomerSearch, fixingTarget]);

  const canSeeExtended = isAdmin || customers.some((row) => row.companyName !== null || row.companyAddress !== null || row.credit !== null);
  const phoneConflictMessage = tx('手机号冲突，请修改', 'Phone number conflict, please update it.');
  const formatOwnerLabel = (row: Record<string, unknown>) => {
    const owner = (row.owner && typeof row.owner === 'object') ? (row.owner as Record<string, unknown>) : null;
    const ownerEmail = owner && typeof owner.email === 'string' ? owner.email : '';
    const ownerRole = owner && typeof owner.role === 'string' ? owner.role : '';
    if (ownerEmail) return `${ownerEmail}${ownerRole ? ` (${ownerRole})` : ''}`;
    return String(row.ownerId || '-');
  };
  const truncateLongText = (value: string, maxLength = 20) => {
    const normalized = value.trim();
    if (!normalized) return '-';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
  };
  const activeOwnerId = isAdmin ? (form.ownerId || importOwnerId || defaultOwnerId) : defaultOwnerId;
  const formPhoneConflict = (() => {
    const phoneTokens = splitPhoneTokens(form.phone);
    if (phoneTokens.length === 0) return false;
    const editingId = editing ? String(editing.id || '') : '';
    return customers.some((row) => {
      const rowOwnerId = String(row.ownerId || '');
      if (rowOwnerId !== activeOwnerId) return false;
      if (editingId && String(row.id || '') === editingId) return false;
      const rowTokens = splitPhoneTokens(row.phone);
      return rowTokens.some((token) => phoneTokens.includes(token));
    });
  })();
  const editingCustomerId = editing ? String(editing.id || '') : '';

  const loadCompanyFiles = useCallback(async (customerId: string) => {
    const id = customerId.trim();
    if (!id) {
      setCompanyFiles([]);
      return;
    }
    try {
      const result = await apiCall(`customer?action=company-files&customerId=${encodeURIComponent(id)}`);
      if (result.success && Array.isArray(result.data)) {
        setCompanyFiles(result.data as CustomerCompanyFileSummary[]);
      }
    } catch (error) {
      setCompanyFileError(getApiErrorMessage(error, tx('加载客户公司文件失败', 'Failed to load customer company files.')));
    }
  }, [tx]);

  useEffect(() => {
    if (!editingCustomerId) {
      setCompanyFiles((prev) => (prev.length > 0 ? [] : prev));
      setCompanyFileError((prev) => (prev ? '' : prev));
      setCompanyFileProposal((prev) => (prev ? null : prev));
      return;
    }
    void loadCompanyFiles(editingCustomerId);
  }, [editingCustomerId, loadCompanyFiles]);

  const buildCompanyFileProposal = useCallback((ocrResult: Record<string, unknown>) => {
    const labels = {
      companyName: 'COMPANY_NAME',
      companyAddress: 'COMPANY_ADDRESS',
      city: 'CITY',
    } as const;
    const keys = Object.keys(labels) as Array<keyof typeof labels>;
    const proposalFields: CustomerCompanyFileOverwriteProposal['fields'] = [];
    const directPatch: Partial<typeof form> = {};

    for (const key of keys) {
      const nextValue = String(ocrResult[key] || '').trim();
      if (!nextValue) continue;
      const currentValue = String(form[key] || '').trim();
      if (!currentValue) {
        directPatch[key] = nextValue;
      } else if (currentValue !== nextValue) {
        proposalFields.push({
          key,
          label: labels[key],
          currentValue,
          nextValue,
          selected: true,
        });
      }
    }

    if (Object.keys(directPatch).length > 0) {
      setForm((prev) => ({ ...prev, ...directPatch }));
    }
    setCompanyFileProposal(proposalFields.length > 0 ? { fields: proposalFields } : null);
  }, [form, setForm]);

  const handleCompanyFileUpload = useCallback(async (file: File) => {
    const customerId = editing ? String(editing.id || '') : '';
    if (!customerId) return;
    setCompanyFileUploading(true);
    setCompanyFileError('');
    try {
      const formData = new FormData();
      formData.append('action', 'recognize-company-file');
      formData.append('customerId', customerId);
      formData.append('file', file);
      const result = await apiUploadCall('customer', formData);
      if (!result.success) throw result;
      await loadCompanyFiles(customerId);
      const data = (result.data && typeof result.data === 'object') ? result.data as Record<string, unknown> : {};
      const ocrResult = (data.ocrResult && typeof data.ocrResult === 'object') ? data.ocrResult as Record<string, unknown> : {};
      const recognitionMessage = String(data.recognitionMessage || '').trim();
      if (recognitionMessage) {
        setCompanyFileError(recognitionMessage);
      }
      buildCompanyFileProposal(ocrResult);
    } catch (error) {
      setCompanyFileError(getApiErrorMessage(error, tx('上传客户公司文件失败', 'Failed to upload customer company file.')));
    } finally {
      setCompanyFileUploading(false);
    }
  }, [buildCompanyFileProposal, editing, loadCompanyFiles, tx]);

  const handleCompanyFileDelete = useCallback(async (assetId: string) => {
    const customerId = editing ? String(editing.id || '') : '';
    if (!customerId || !assetId) return;
    setCompanyFileUploading(true);
    setCompanyFileError('');
    try {
      const result = await apiCall('customer', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete-company-file', assetId }),
      });
      if (!result.success) throw result;
      await loadCompanyFiles(customerId);
    } catch (error) {
      setCompanyFileError(getApiErrorMessage(error, tx('删除客户公司文件失败', 'Failed to delete customer company file.')));
    } finally {
      setCompanyFileUploading(false);
    }
  }, [editing, loadCompanyFiles, tx]);

  const applyCompanyFileOcrProposal = useCallback((keys: Array<CustomerCompanyFileOverwriteProposal['fields'][number]['key']>) => {
    if (!companyFileProposal) return;
    const selected = new Set(keys);
    const patch: Partial<typeof form> = {};
    for (const field of companyFileProposal.fields) {
      if (selected.has(field.key)) {
        patch[field.key] = field.nextValue;
      }
    }
    if (Object.keys(patch).length > 0) {
      setForm((prev) => ({ ...prev, ...patch }));
    }
    setCompanyFileProposal(null);
  }, [companyFileProposal, setForm]);

  const loadOrderNameHistory = useCallback(async (
    target: { customerId: string; orderName: string },
    pagination: {
      orderPage: number;
      orderPageSize: number;
      receiptPage: number;
      receiptPageSize: number;
    },
  ) => {
    const requestToken = orderHistoryRequestGuard.nextToken();
    const searchParams = new URLSearchParams({
      action: 'order-history',
      customerId: target.customerId,
      orderName: target.orderName,
      orderPage: String(pagination.orderPage),
      orderPageSize: String(pagination.orderPageSize),
      receiptPage: String(pagination.receiptPage),
      receiptPageSize: String(pagination.receiptPageSize),
    });

    setOrderHistoryLoading(true);
    setOrderHistoryError('');
    try {
      const result = await apiCall(`customer?${searchParams.toString()}`);
      if (!orderHistoryRequestGuard.isLatest(requestToken)) return;
      if (result.success && result.data) {
        setOrderHistory(result.data as CustomerOrderHistory);
      } else {
        setOrderHistoryError(String(result.message || result.error || tx('加载失败', 'Load failed')));
      }
    } catch (error) {
      if (orderHistoryRequestGuard.isLatest(requestToken)) {
        setOrderHistoryError(getApiErrorMessage(error, tx('加载失败', 'Load failed')));
      }
    } finally {
      if (orderHistoryRequestGuard.isLatest(requestToken)) {
        setOrderHistoryLoading(false);
      }
    }
  }, [orderHistoryRequestGuard, tx]);

  const openOrderNameHistory = (row: Record<string, unknown>, orderName: string) => {
    const customerId = String(row.id || '').trim();
    const trimmedOrderName = orderName.trim();
    if (!customerId || !trimmedOrderName) return;

    const target = { customerId, orderName: trimmedOrderName };
    setOrderHistoryTarget(target);
    setOrderHistoryOpen(true);
    setOrderHistoryError('');
    setOrderHistory(null);
    setOrderHistoryTitle(trimmedOrderName);
    void loadOrderNameHistory(target, {
      orderPage: 1,
      orderPageSize: orderHistoryOrderPageSize,
      receiptPage: 1,
      receiptPageSize: orderHistoryReceiptPageSize,
    });
  };

  const changeOrderHistoryPage = (orderPage: number) => {
    if (!orderHistoryTarget) return;
    void loadOrderNameHistory(orderHistoryTarget, {
      orderPage,
      orderPageSize: orderHistory?.orderPagination?.pageSize || orderHistoryOrderPageSize,
      receiptPage: orderHistory?.receiptPagination?.page || 1,
      receiptPageSize: orderHistory?.receiptPagination?.pageSize || orderHistoryReceiptPageSize,
    });
  };

  const changeReceiptHistoryPage = (receiptPage: number) => {
    if (!orderHistoryTarget) return;
    void loadOrderNameHistory(orderHistoryTarget, {
      orderPage: orderHistory?.orderPagination?.page || 1,
      orderPageSize: orderHistory?.orderPagination?.pageSize || orderHistoryOrderPageSize,
      receiptPage,
      receiptPageSize: orderHistory?.receiptPagination?.pageSize || orderHistoryReceiptPageSize,
    });
  };

  const changeOrderHistoryPageSize = (pageSize: number) => {
    if (!orderHistoryTarget) return;
    saveOrderHistoryOrderPageSize(pageSize);
    void loadOrderNameHistory(orderHistoryTarget, {
      orderPage: 1,
      orderPageSize: pageSize,
      receiptPage: orderHistory?.receiptPagination?.page || 1,
      receiptPageSize: orderHistory?.receiptPagination?.pageSize || orderHistoryReceiptPageSize,
    });
  };

  const changeReceiptHistoryPageSize = (pageSize: number) => {
    if (!orderHistoryTarget) return;
    saveOrderHistoryReceiptPageSize(pageSize);
    void loadOrderNameHistory(orderHistoryTarget, {
      orderPage: orderHistory?.orderPagination?.page || 1,
      orderPageSize: orderHistory?.orderPagination?.pageSize || orderHistoryOrderPageSize,
      receiptPage: 1,
      receiptPageSize: pageSize,
    });
  };

  const normalizeConsigneeRows = (rawRows: unknown): CustomerConsigneeItem[] => {
    if (!Array.isArray(rawRows)) return [];
    const rows: CustomerConsigneeItem[] = [];
    for (const item of rawRows) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id || '').trim();
      const consignee = String(row.consignee || '').trim();
      if (!id || !consignee) continue;
      rows.push({
        id,
        consignee,
        isPrimary: Boolean(row.isPrimary),
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      });
    }
    return rows;
  };

  const localConsigneeRows = (row: Record<string, unknown>): CustomerConsigneeItem[] => {
    const rows = normalizeConsigneeRows(row.consignees);
    if (rows.length > 0) return rows;
    const legacy = String(row.consignee || '').trim();
    return legacy ? [{ id: `legacy-${String(row.id || '')}`, consignee: legacy, isPrimary: true }] : [];
  };

  const loadConsignees = async (customerId: string) => {
    if (!customerId) return;
    setConsigneeLoading(true);
    setConsigneeError('');
    const result = await apiCall(`customer?action=consignees&customerId=${encodeURIComponent(customerId)}`);
    if (result.success) {
      setConsigneeRows(normalizeConsigneeRows(result.data));
    } else {
      setConsigneeError(String(result.message || result.error || tx('CONSIGNEE加载失败', 'Failed to load CONSIGNEE')));
    }
    setConsigneeLoading(false);
  };

  const openConsigneeManager = (row: Record<string, unknown>) => {
    const customerId = String(row.id || '').trim();
    setConsigneeDialogCustomer(row);
    setConsigneeRows(localConsigneeRows(row));
    setConsigneeInput('');
    setConsigneeError('');
    if (customerId) void loadConsignees(customerId);
  };

  const submitConsignee = async () => {
    const customerId = String(consigneeDialogCustomer?.id || '').trim();
    const consignee = consigneeInput.trim();
    if (!customerId || !consignee) return;
    setConsigneeSubmitting(true);
    setConsigneeError('');
    try {
      const result = await apiCall('customer', {
        method: 'POST',
        body: JSON.stringify({
          action: 'consignee-add',
          customerId,
          consignee,
        }),
      });
      if (result.success) {
        setConsigneeInput('');
        await loadConsignees(customerId);
        await loadCustomers();
      } else {
        setConsigneeError(String(result.message || result.error || tx('CONSIGNEE新增失败', 'Failed to add CONSIGNEE')));
      }
    } catch (error) {
      setConsigneeError(getErrorMessage(error, tx('CONSIGNEE新增失败', 'Failed to add CONSIGNEE')));
    } finally {
      setConsigneeSubmitting(false);
    }
  };

  const deleteConsignee = async (consigneeId: string) => {
    const customerId = String(consigneeDialogCustomer?.id || '').trim();
    if (!customerId || !consigneeId || consigneeId.startsWith('legacy-')) return;
    setConsigneeSubmitting(true);
    setConsigneeError('');
    try {
      const result = await apiCall('customer', {
        method: 'POST',
        body: JSON.stringify({
          action: 'consignee-delete',
          customerId,
          consigneeId,
        }),
      });
      if (result.success) {
        await loadConsignees(customerId);
        await loadCustomers();
      } else {
        setConsigneeError(String(result.message || result.error || tx('CONSIGNEE删除失败', 'Failed to delete CONSIGNEE')));
      }
    } catch (error) {
      setConsigneeError(getErrorMessage(error, tx('CONSIGNEE删除失败', 'Failed to delete CONSIGNEE')));
    } finally {
      setConsigneeSubmitting(false);
    }
  };

  const setPrimaryConsignee = async (consigneeId: string) => {
    const customerId = String(consigneeDialogCustomer?.id || '').trim();
    if (!customerId || !consigneeId || consigneeId.startsWith('legacy-')) return;
    setConsigneeSubmitting(true);
    setConsigneeError('');
    try {
      const result = await apiCall('customer', {
        method: 'POST',
        body: JSON.stringify({
          action: 'consignee-set-primary',
          customerId,
          consigneeId,
        }),
      });
      if (result.success) {
        await loadConsignees(customerId);
        await loadCustomers();
      } else {
        setConsigneeError(String(result.message || result.error || tx('默认CONSIGNEE更新失败', 'Failed to update default CONSIGNEE')));
      }
    } catch (error) {
      setConsigneeError(getErrorMessage(error, tx('默认CONSIGNEE更新失败', 'Failed to update default CONSIGNEE')));
    } finally {
      setConsigneeSubmitting(false);
    }
  };

  const consigneeDialogCustomerLabel = (() => {
    if (!consigneeDialogCustomer) return '';
    const mark = String(consigneeDialogCustomer.mark || '').trim();
    const name = String(consigneeDialogCustomer.companyName || consigneeDialogCustomer.name || '').trim();
    return [mark, name].filter(Boolean).join(' / ');
  })();

  return (
    <div className="space-y-6">
      <CustomerToolbar
        isAdmin={isAdmin}
        search={search}
        importOwnerId={importOwnerId}
        ownerOptions={ownerOptions}
        customerImporting={customerImporting}
        tx={tx}
        inputRef={customerImportInputRef}
        onFileChange={(file) => void handleCustomerExcelImport(file)}
        onSearchChange={setSearch}
        onSearchSubmit={(value) => {
          setSearch(value);
          void loadCustomers(value);
        }}
        onImportOwnerChange={setImportOwnerId}
        onDownloadTemplate={downloadCustomerImportTemplate}
        onOpenImport={() => customerImportInputRef.current?.click()}
        onOpenCreate={() => {
          setEditing(null);
          resetForm();
          setShowCreate(true);
        }}
      />

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">{tx('客户列表', 'Customer List')}</TabsTrigger>
          <TabsTrigger value="fixes">{tx('待修复客户信息', 'Customer Fix Queue')}</TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <CustomerList
            customers={customers}
            canSeeExtended={canSeeExtended}
            isAdmin={isAdmin}
            tx={tx}
            phoneConflictMessage={phoneConflictMessage}
            formatOwnerLabel={formatOwnerLabel}
            truncateLongText={truncateLongText}
            onPreviewLongText={(label, value) => setCustomerLongTextPreview({ label, value })}
            onOpenOrderNameHistory={(row, orderName) => { void openOrderNameHistory(row, orderName); }}
            onOpenConsignees={openConsigneeManager}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </TabsContent>

        <TabsContent value="fixes">
          <CustomerFixQueue
            fixOrders={fixOrders}
            fixReceipts={fixReceipts}
            tx={tx}
            onOpenFix={openFix}
          />
        </TabsContent>
      </Tabs>

      <CustomerFormDialog
        open={showCreate}
        editing={editing}
        form={form}
        isAdmin={isAdmin}
        ownerOptions={ownerOptions}
        tx={tx}
        phoneConflict={formPhoneConflict}
        phoneConflictMessage={phoneConflictMessage}
        companyFiles={companyFiles}
        companyFileUploading={companyFileUploading}
        companyFileError={companyFileError}
        companyFileProposal={companyFileProposal}
        onOpenChange={setShowCreate}
        onFormChange={(updater) => setForm(updater)}
        onSubmit={handleCreateOrUpdate}
        onCompanyFileUpload={handleCompanyFileUpload}
        onCompanyFileDelete={handleCompanyFileDelete}
        onApplyCompanyFileOcrProposal={applyCompanyFileOcrProposal}
        onDismissCompanyFileOcrProposal={() => setCompanyFileProposal(null)}
      />

      <CustomerFixDialog
        fixingTarget={fixingTarget}
        form={form}
        isAdmin={isAdmin}
        ownerOptions={ownerOptions}
        existingCustomerSearch={fixCustomerSearch}
        existingCustomerOptions={fixCustomerSearch.trim() ? fixCustomerOptions : []}
        existingCustomerId={fixExistingCustomerId}
        existingCustomerSearching={Boolean(fixCustomerSearch.trim()) && fixCustomerSearching}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) {
            setFixingTarget(null);
            setFixExistingCustomerId('');
            setFixCustomerSearch('');
            setFixCustomerOptions([]);
            setFixCustomerSearching(false);
          }
        }}
        onFormChange={(updater) => setForm(updater)}
        onExistingCustomerSearchChange={setFixCustomerSearch}
        onExistingCustomerSearchSubmit={(value) => {
          const query = value.trim();
          setFixCustomerSearch(value);
          if (!query) return;
          setFixCustomerSearching(true);
          void apiCall(`customer?search=${encodeURIComponent(query)}`)
            .then((result) => {
              setFixCustomerOptions(result.success && Array.isArray(result.data) ? result.data.slice(0, 10) : []);
            })
            .catch(() => setFixCustomerOptions([]))
            .finally(() => setFixCustomerSearching(false));
        }}
        onExistingCustomerSelect={(row) => {
          setFixExistingCustomerId(String(row.id || ''));
          setForm((prev) => ({
            ...prev,
            mark: String(row.mark || prev.mark || ''),
            orderName: String(row.orderName || prev.orderName || '').toUpperCase(),
            name: String(row.name || prev.name || ''),
            phone: String(row.phone || prev.phone || ''),
            city: String(row.city || prev.city || ''),
            companyName: String(row.companyName || prev.companyName || ''),
            companyAddress: String(row.companyAddress || prev.companyAddress || ''),
            credit: row.credit === null || row.credit === undefined ? prev.credit : String(row.credit),
            ownerId: String(row.ownerId || prev.ownerId || ''),
          }));
        }}
        onSubmit={submitFix}
      />

      <ImportResultDialog
        open={showCustomerImportIssues}
        onOpenChange={(open) => { if (!open) closeCustomerImportDialog(); else setShowCustomerImportIssues(true); }}
        title={tx('客户导入问题行处理', 'Customer Import Issue Rows')}
        description={customerImportMessage || tx('请查看导入结果，失败行可编辑后重试。', 'Check import results. Failed rows can be edited and retried.')}
        filter={customerImportTable.filter}
        onFilterChange={customerImportTable.setFilter}
        rows={customerImportTable.pagedRows}
        columns={customerImportColumns}
        attemptCount={customerImportTable.attemptCount}
        page={customerImportTable.page}
        totalPages={customerImportTable.totalPages}
        onPageChange={customerImportTable.setPage}
        onClose={closeCustomerImportDialog}
        onRetry={retryCustomerIssueRows}
        retrying={customerIssueSubmitting}
        retryDisabled={customerImportTable.latestFailedRows.length === 0}
      />

      <CustomerLongTextPreviewDialog
        preview={customerLongTextPreview}
        onOpenChange={(open) => { if (!open) setCustomerLongTextPreview(null); }}
      />

      <CustomerOrderHistoryDialog
        open={orderHistoryOpen}
        loading={orderHistoryLoading}
        error={orderHistoryError}
        title={orderHistoryTitle}
        history={orderHistory}
        tx={tx}
        orderPageSizeOptions={orderHistoryOrderPageSizeOptions}
        receiptPageSizeOptions={orderHistoryReceiptPageSizeOptions}
        onOrderPreviousPage={() => changeOrderHistoryPage(Math.max(1, (orderHistory?.orderPagination?.page || 1) - 1))}
        onOrderNextPage={() => changeOrderHistoryPage((orderHistory?.orderPagination?.page || 1) + 1)}
        onOrderPageSizeChange={changeOrderHistoryPageSize}
        onReceiptPreviousPage={() => changeReceiptHistoryPage(Math.max(1, (orderHistory?.receiptPagination?.page || 1) - 1))}
        onReceiptNextPage={() => changeReceiptHistoryPage((orderHistory?.receiptPagination?.page || 1) + 1)}
        onReceiptPageSizeChange={changeReceiptHistoryPageSize}
        onOpenChange={(open) => {
          setOrderHistoryOpen(open);
          if (!open) {
            orderHistoryRequestGuard.nextToken();
            setOrderHistory(null);
            setOrderHistoryError('');
            setOrderHistoryTarget(null);
          }
        }}
      />

      <CustomerConsigneeDialog
        open={Boolean(consigneeDialogCustomer)}
        customerLabel={consigneeDialogCustomerLabel}
        consignees={consigneeRows}
        inputValue={consigneeInput}
        loading={consigneeLoading}
        submitting={consigneeSubmitting}
        error={consigneeError}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) {
            setConsigneeDialogCustomer(null);
            setConsigneeRows([]);
            setConsigneeInput('');
            setConsigneeError('');
          }
        }}
        onInputChange={setConsigneeInput}
        onAdd={() => { void submitConsignee(); }}
        onDelete={(id) => { void deleteConsignee(id); }}
        onSetPrimary={(id) => { void setPrimaryConsignee(id); }}
      />
    </div>
  );
}
