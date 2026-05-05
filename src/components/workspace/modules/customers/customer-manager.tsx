'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  apiCall,
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
  CustomerFormDialog,
  CustomerList,
  CustomerLongTextPreviewDialog,
  CustomerToolbar,
} from './components';
import type { CustomerOwnerOption } from './types';
import { useCustomerActions, useCustomerForms, useCustomerImportColumns } from './hooks';

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
  const [search, setSearch] = useState('');
  const customerRequestGuard = useLatestRequestGuard();
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

  const loadCustomers = useCallback(async () => {
    const requestToken = customerRequestGuard.nextToken();
    const trimmedSearch = search.trim();
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
        onOpenChange={setShowCreate}
        onFormChange={(updater) => setForm(updater)}
        onSubmit={handleCreateOrUpdate}
      />

      <CustomerFixDialog
        fixingTarget={fixingTarget}
        form={form}
        isAdmin={isAdmin}
        ownerOptions={ownerOptions}
        tx={tx}
        onOpenChange={(open) => { if (!open) setFixingTarget(null); }}
        onFormChange={(updater) => setForm(updater)}
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
    </div>
  );
}
