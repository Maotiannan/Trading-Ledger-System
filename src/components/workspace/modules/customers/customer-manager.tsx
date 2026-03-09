'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CustomerCandidate,
  apiCall,
  initCustomerImportRowViews,
  mergeCustomerImportRowViews,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  useUiText,
  type CustomerImportRowView,
} from '@/components/workspace/shared';
import { ImportResultDialog, type ImportResultDialogColumn } from '@/components/workspace/components/import-result-dialog';
import { useImportResultTable } from '@/components/workspace/hooks';
import {
  Loader2, Users, Upload, Check, X, AlertTriangle, Eye, Pencil, Plus, Trash2
} from 'lucide-react';

export function CustomerManager() {
  const tx = useUiText();
  const { user } = useStore();
  const isAdmin = user?.role === 'ADMIN';
  const defaultOwnerId = isAdmin ? (user?.id || '') : (user?.id || '');
  const [customers, setCustomers] = useState<Array<Record<string, unknown>>>([]);
  const [ownerOptions, setOwnerOptions] = useState<Array<{ id: string; email: string; name: string | null; role: string; level: number }>>([]);
  const [importOwnerId, setImportOwnerId] = useState('');
  const [fixOrders, setFixOrders] = useState<Array<Record<string, unknown>>>([]);
  const [fixReceipts, setFixReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [fixingTarget, setFixingTarget] = useState<{ type: 'order' | 'receipt'; id: string } | null>(null);
  const [customerImporting, setCustomerImporting] = useState(false);
  const [customerImportRows, setCustomerImportRows] = useState<CustomerImportRowView[]>([]);
  const [showCustomerImportIssues, setShowCustomerImportIssues] = useState(false);
  const [customerIssueSubmitting, setCustomerIssueSubmitting] = useState(false);
  const [customerImportMessage, setCustomerImportMessage] = useState('');
  const [customerLongTextPreview, setCustomerLongTextPreview] = useState<{ label: string; value: string } | null>(null);
  const customerImportInputRef = useRef<HTMLInputElement | null>(null);
  const customerImportTable = useImportResultTable(customerImportRows);
  const [form, setForm] = useState({
    mark: '',
    orderName: '',
    name: '',
    phone: '',
    city: '',
    consignee: '',
    companyName: '',
    credit: '',
    companyAddress: '',
    ownerId: defaultOwnerId,
  });

  const resetForm = () => {
    setForm({
      mark: '',
      orderName: '',
      name: '',
      phone: '',
      city: '',
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
      ownerId: isAdmin ? (importOwnerId || defaultOwnerId) : defaultOwnerId,
    });
  };

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
  }, [defaultOwnerId, isAdmin]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadCustomers();
      void loadFixes();
      void loadOwnerOptions();
    });
  }, [loadCustomers, loadFixes, loadOwnerOptions]);

  const handleCreateOrUpdate = async () => {
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
      alert(result.error || tx('保存失败', 'Save failed'));
      return;
    }
    setShowCreate(false);
    setEditing(null);
    resetForm();
    loadCustomers();
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) return;
    if (!confirm(tx('确定删除该客户吗？', 'Delete this customer?'))) return;
    const result = await apiCall('customer', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
    if (!result.success) {
      alert(result.error || tx('删除失败', 'Delete failed'));
      return;
    }
    loadCustomers();
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditing(row);
    setForm({
      mark: String(row.mark || ''),
      orderName: String(row.orderName || ''),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      city: String(row.city || ''),
      consignee: String(row.consignee || ''),
      companyName: String(row.companyName || ''),
      credit: row.credit === null || row.credit === undefined ? '' : String(row.credit),
      companyAddress: String(row.companyAddress || ''),
      ownerId: String(row.ownerId || importOwnerId || defaultOwnerId),
    });
    setShowCreate(true);
  };

  const openFix = (type: 'order' | 'receipt', row: Record<string, unknown>) => {
    setFixingTarget({ type, id: String(row.id) });
    setForm({
      mark: String(row.customerMark || ''),
      orderName: String(row.customerName || ''),
      name: '',
      phone: String(row.customerPhone || ''),
      city: String(row.customerCity || ''),
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
      ownerId: importOwnerId || defaultOwnerId,
    });
  };

  const submitFix = async () => {
    if (!fixingTarget) return;
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
      alert(result.error || tx('修复失败', 'Fix failed'));
      return;
    }
    setFixingTarget(null);
    resetForm();
    loadCustomers();
    loadFixes();
  };

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

  const downloadCustomerImportTemplate = async () => {
    try {
      const response = await fetch('/api/customer?action=import-template', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(tx('模板下载失败', 'Failed to download template'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'customer-import-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('模板下载失败', 'Failed to download template'));
    }
  };

  const handleCustomerExcelImport = async (file: File) => {
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
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }

      const rowResults = toCustomerImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toCustomerImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      setCustomerImportRows(initCustomerImportRowViews(fallbackResults));
      customerImportTable.reset();
      setCustomerImportMessage(String(result?.message || result?.error || tx('导入完成', 'Import completed')));
      setShowCustomerImportIssues(true);
      await loadCustomers();
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('导入失败', 'Import failed'));
    } finally {
      setCustomerImporting(false);
      if (customerImportInputRef.current) customerImportInputRef.current.value = '';
    }
  };

  const updateCustomerImportIssue = (rowNo: number, field: keyof Omit<CustomerImportRowView, 'latestStatus' | 'latestReason' | 'attempts'>, value: string) => {
    setCustomerImportRows((prev) => prev.map((row) => {
      if (row.rowNo !== rowNo || row.latestStatus !== 'FAILED') return row;
      return { ...row, [field]: value };
    }));
  };

  const retryCustomerIssueRows = async () => {
    if (customerImportTable.latestFailedRows.length === 0) return;
    setCustomerIssueSubmitting(true);
    try {
      const response = await fetch('/api/customer', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import-rows',
          ownerId: isAdmin ? (importOwnerId || defaultOwnerId) : defaultOwnerId,
          rows: customerImportTable.latestFailedRows.map((row) => ({
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
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      const rowResults = toCustomerImportRowResults(result?.rowResults);
      const fallbackResults = rowResults.length > 0 ? rowResults : toCustomerImportRowResultsFromIssues(result?.issueRows);
      if (fallbackResults.length === 0) {
        const details = Array.isArray(result?.details) ? `\n${result.details.join('\n')}` : '';
        throw new Error(`${result?.error || tx('导入失败', 'Import failed')}${details}`);
      }
      setCustomerImportRows((prev) => mergeCustomerImportRowViews(prev, fallbackResults));
      setCustomerImportMessage(String(result?.message || tx('重试完成', 'Retry completed')));
      await loadCustomers();
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('导入失败', 'Import failed'));
    } finally {
      setCustomerIssueSubmitting(false);
    }
  };

  const closeCustomerImportDialog = () => {
    setShowCustomerImportIssues(false);
    setCustomerImportRows([]);
    setCustomerImportMessage('');
    customerImportTable.reset();
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
  ]), []);

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
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>MARK</TableHead>
                    <TableHead>ORDER_NAME</TableHead>
                    <TableHead>NAME</TableHead>
                    <TableHead>PHONE</TableHead>
                    <TableHead>CITY</TableHead>
                    <TableHead>CONSIGNEE</TableHead>
                    <TableHead>{tx('绑定账户', 'Binding')}</TableHead>
                    {canSeeExtended && <TableHead>COMPANY_NAME</TableHead>}
                    {canSeeExtended && <TableHead>CREDIT</TableHead>}
                    {canSeeExtended && <TableHead>COMPANY_ADDRESS</TableHead>}
                    <TableHead>{tx('操作', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((row) => (
                    <TableRow key={String(row.id)}>
                      {(() => {
                        const consigneeFull = String(row.consignee || '').trim();
                        const addressFull = String(row.companyAddress || '').trim();
                        return (
                          <>
                      <TableCell>{String(row.mark || '-')}</TableCell>
                      <TableCell>{String(row.orderName || '-')}</TableCell>
                      <TableCell>{String(row.name || '-')}</TableCell>
                      <TableCell>{String(row.phone || '-')}</TableCell>
                      <TableCell>{String(row.city || '-')}</TableCell>
                      <TableCell>
                        {consigneeFull ? (
                          <button
                            type="button"
                            className="max-w-[220px] truncate text-left hover:underline"
                            title={consigneeFull}
                            onClick={() => setCustomerLongTextPreview({ label: 'CONSIGNEE', value: consigneeFull })}
                          >
                            {truncateLongText(consigneeFull)}
                          </button>
                        ) : '-'}
                      </TableCell>
                      <TableCell>{formatOwnerLabel(row)}</TableCell>
                      {canSeeExtended && <TableCell>{String(row.companyName || '-')}</TableCell>}
                      {canSeeExtended && <TableCell>{row.credit !== null && row.credit !== undefined ? String(row.credit) : '-'}</TableCell>}
                      {canSeeExtended && (
                        <TableCell>
                          {addressFull ? (
                            <button
                              type="button"
                              className="max-w-[260px] truncate text-left hover:underline"
                              title={addressFull}
                              onClick={() => setCustomerLongTextPreview({ label: 'COMPANY_ADDRESS', value: addressFull })}
                            >
                              {truncateLongText(addressFull)}
                            </button>
                          ) : '-'}
                        </TableCell>
                      )}
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(String(row.id))}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                          </>
                        );
                      })()}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fixes">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{tx('待修复 ORDER', 'Orders To Fix')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {fixOrders.map((row) => (
                  <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
                    <div>
                      <div className="font-medium">{String(row.orderNo || '-')}</div>
                      <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
                    </div>
                    <Button size="sm" onClick={() => openFix('order', row)}>{tx('修复', 'Fix')}</Button>
                  </div>
                ))}
                {fixOrders.length === 0 && <p className="text-sm text-gray-500">{tx('暂无', 'None')}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{tx('待修复 RECEIPT', 'Receipts To Fix')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {fixReceipts.map((row) => (
                  <div key={String(row.id)} className="flex justify-between items-center border rounded-md p-2">
                    <div>
                      <div className="font-medium">{String(row.receiptNo || row.orderNo || '-')}</div>
                      <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
                    </div>
                    <Button size="sm" onClick={() => openFix('receipt', row)}>{tx('修复', 'Fix')}</Button>
                  </div>
                ))}
                {fixReceipts.length === 0 && <p className="text-sm text-gray-500">{tx('暂无', 'None')}</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? tx('编辑客户', 'Edit Customer') : tx('创建客户', 'Create Customer')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="MARK*" value={form.mark} onChange={(e) => setForm((p) => ({ ...p, mark: e.target.value }))} />
            <Input placeholder="ORDER_NAME*" value={form.orderName} onChange={(e) => setForm((p) => ({ ...p, orderName: e.target.value }))} />
            <Input placeholder="NAME*" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input placeholder="PHONE*" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            <Input placeholder="CITY*" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
            <Input placeholder={tx('CONSIGNEE(可空)', 'CONSIGNEE (optional)')} value={form.consignee} onChange={(e) => setForm((p) => ({ ...p, consignee: e.target.value }))} />
            {isAdmin && (
              <select
                className="h-10 border rounded-md px-3 text-sm bg-white"
                value={form.ownerId}
                onChange={(e) => setForm((p) => ({ ...p, ownerId: e.target.value }))}
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.email} (${option.role})`}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <>
                <Input placeholder="COMPANY_NAME" value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} />
                <Input placeholder="CREDIT" type="number" min="0" step="0.01" value={form.credit} onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))} />
                <Input placeholder="COMPANY_ADDRESS" value={form.companyAddress} onChange={(e) => setForm((p) => ({ ...p, companyAddress: e.target.value }))} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleCreateOrUpdate}>{tx('保存', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fixingTarget} onOpenChange={(open) => { if (!open) setFixingTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('修复客户信息并加入客户库', 'Fix Customer Info And Save')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="MARK*" value={form.mark} onChange={(e) => setForm((p) => ({ ...p, mark: e.target.value }))} />
            <Input placeholder="ORDER_NAME*" value={form.orderName} onChange={(e) => setForm((p) => ({ ...p, orderName: e.target.value }))} />
            <Input placeholder="NAME*" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <Input placeholder="PHONE*" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            <Input placeholder="CITY*" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
            <Input placeholder={tx('CONSIGNEE(可空)', 'CONSIGNEE (optional)')} value={form.consignee} onChange={(e) => setForm((p) => ({ ...p, consignee: e.target.value }))} />
            {isAdmin && (
              <select
                className="h-10 border rounded-md px-3 text-sm bg-white"
                value={form.ownerId}
                onChange={(e) => setForm((p) => ({ ...p, ownerId: e.target.value }))}
              >
                {ownerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.email} (${option.role})`}
                  </option>
                ))}
              </select>
            )}
            {isAdmin && (
              <>
                <Input placeholder="COMPANY_NAME" value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} />
                <Input placeholder="CREDIT" type="number" min="0" step="0.01" value={form.credit} onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))} />
                <Input placeholder="COMPANY_ADDRESS" value={form.companyAddress} onChange={(e) => setForm((p) => ({ ...p, companyAddress: e.target.value }))} />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixingTarget(null)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={submitFix}>{tx('修复并保存', 'Fix And Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={!!customerLongTextPreview} onOpenChange={(open) => { if (!open) setCustomerLongTextPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{customerLongTextPreview?.label || 'Text'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto rounded-md border p-3 whitespace-pre-wrap break-words text-sm">
            {customerLongTextPreview?.value || '-'}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
