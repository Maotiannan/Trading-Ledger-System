'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  apiCall,
  useUiText,
  type CustomerImportRowView,
} from '@/components/workspace/shared';
import { ImportResultDialog, type ImportResultDialogColumn } from '@/components/workspace/components/import-result-dialog';
import { useImportResultTable } from '@/components/workspace/hooks';
import {
  CustomerFixDialog,
  CustomerFixQueue,
  CustomerFormDialog,
  CustomerList,
  CustomerLongTextPreviewDialog,
} from './components';
import type { CustomerOwnerOption } from './types';
import { useCustomerActions, useCustomerForms } from './hooks';
import { Loader2, Upload, Plus } from 'lucide-react';

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

  const loadCustomers = useCallback(async () => {
    const result = await apiCall(`customer${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
    if (result.success) setCustomers(Array.isArray(result.data) ? result.data : []);
  }, [search]);

  const loadFixes = useCallback(async () => {
    const result = await apiCall('customer/fixes');
    if (result.success && result.data) {
      setFixOrders(Array.isArray(result.data.orders) ? result.data.orders : []);
      setFixReceipts(Array.isArray(result.data.receipts) ? result.data.receipts : []);
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

  const customerImportColumns: ImportResultDialogColumn<CustomerImportRowView>[] = useMemo(() => ([
    {
      key: 'mark',
      header: 'MARK',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.mark} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'mark', e.target.value)} />
      ),
    },
    {
      key: 'orderName',
      header: 'ORDER_NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.orderName} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'orderName', e.target.value)} />
      ),
    },
    {
      key: 'name',
      header: 'NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.name} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'name', e.target.value)} />
      ),
    },
    {
      key: 'phone',
      header: 'PHONE',
      className: 'min-w-[180px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[180px]" value={row.phone} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'phone', e.target.value)} />
      ),
    },
    {
      key: 'city',
      header: 'CITY',
      className: 'min-w-[160px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[160px]" value={row.city} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'city', e.target.value)} />
      ),
    },
    {
      key: 'consignee',
      header: 'CONSIGNEE',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.consignee} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'consignee', e.target.value)} />
      ),
    },
    {
      key: 'companyName',
      header: 'COMPANY_NAME',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.companyName} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'companyName', e.target.value)} />
      ),
    },
    {
      key: 'credit',
      header: 'CREDIT',
      className: 'min-w-[140px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[140px]" value={row.credit} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'credit', e.target.value)} />
      ),
    },
    {
      key: 'companyAddress',
      header: 'COMPANY_ADDRESS',
      className: 'min-w-[320px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[320px]" value={row.companyAddress} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'companyAddress', e.target.value)} />
      ),
    },
    {
      key: 'ownerEmail',
      header: 'SALES_EMAIL',
      className: 'min-w-[220px]',
      renderCell: (row, canEdit) => (
        <Input className="min-w-[220px]" value={row.ownerEmail} disabled={!canEdit} onChange={(e) => updateCustomerImportIssue(row.rowNo, 'ownerEmail', e.target.value)} />
      ),
    },
  ]), [updateCustomerImportIssue]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('客户管理', 'Customer Management')}</h2>
        <div className="flex gap-2">
          <input
            ref={customerImportInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCustomerExcelImport(file);
            }}
          />
          <Input placeholder={tx('搜索 mark/order_name/name/phone/city', 'Search mark/order_name/name/phone/city')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
          {isAdmin && (
            <select
              className="h-10 border rounded-md px-3 text-sm bg-white"
              value={importOwnerId}
              onChange={(e) => setImportOwnerId(e.target.value)}
              title={tx('批量导入默认绑定Sales', 'Default sales binding for import')}
            >
              {ownerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${option.email} (${option.role})`}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" onClick={downloadCustomerImportTemplate}>
            {tx('下载客户模板', 'Download Customer Template')}
          </Button>
          <Button
            variant="outline"
            disabled={customerImporting}
            onClick={() => customerImportInputRef.current?.click()}
          >
            {customerImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {tx('批量上传客户', 'Bulk Import Customers')}
          </Button>
          <Button onClick={() => { setEditing(null); resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('新建客户', 'New Customer')}
          </Button>
        </div>
      </div>

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
