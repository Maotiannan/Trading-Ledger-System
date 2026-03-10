'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import {
  CustomerCandidate,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import { ImportResultDialog, type ImportResultDialogColumn } from '@/components/workspace/components/import-result-dialog';
import { useImportResultTable } from '@/components/workspace/hooks';
import {
  CreateInvoiceDialog,
  EditOrderDialog,
  InvoiceList,
  OrderHistoryDialog,
  RematchDialog,
  TransferBalanceDialog,
} from './components';
import type {
  EditingInvoiceOrder,
  InvoiceDraftOrder,
  RematchPreviewGroup,
  RematchSelection,
  TransferFromOrder,
} from './types';
import { Loader2, Plus, Upload, RefreshCw } from 'lucide-react';

export function InvoiceManager() {
  const tx = useUiText();
  const { invoices, setInvoices, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [invNo, setInvNo] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [orders, setOrders] = useState<InvoiceDraftOrder[]>([{ orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 展开状态
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  
  // 编辑订单对话框
  const [editingOrder, setEditingOrder] = useState<EditingInvoiceOrder | null>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(false);
  const [orderFormError, setOrderFormError] = useState('');
  
  // 添加订单到现有账单
  const [addingOrderToInvoice, setAddingOrderToInvoice] = useState<string | null>(null);
  const [newOrderNo, setNewOrderNo] = useState('');
  const [newOrderAmount, setNewOrderAmount] = useState('');
  const [newOrderCustomerMark, setNewOrderCustomerMark] = useState('');
  const [newOrderCustomerName, setNewOrderCustomerName] = useState('');
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderCustomerCandidates, setNewOrderCustomerCandidates] = useState<CustomerCandidate[]>([]);
  const [addError, setAddError] = useState('');
  
  // 转移余额对话框
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferFromOrder, setTransferFromOrder] = useState<TransferFromOrder | null>(null);
  const [transferToOrderNo, setTransferToOrderNo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  
  // 刷新匹配状态
  const [refreshing, setRefreshing] = useState(false);
  const [showRematchDialog, setShowRematchDialog] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [applyingRematch, setApplyingRematch] = useState(false);
  const [rematchGroups, setRematchGroups] = useState<RematchPreviewGroup[]>([]);
  const [rematchSelections, setRematchSelections] = useState<Record<string, RematchSelection>>({});
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [orderHistoryTitle, setOrderHistoryTitle] = useState('');
  const [orderHistoryRows, setOrderHistoryRows] = useState<Array<Record<string, unknown>>>([]);
  const [editingOrderCandidates, setEditingOrderCandidates] = useState<CustomerCandidate[]>([]);
  const [invoiceImporting, setInvoiceImporting] = useState(false);
  const [invoiceImportRows, setInvoiceImportRows] = useState<InvoiceImportRowView[]>([]);
  const [showInvoiceImportIssues, setShowInvoiceImportIssues] = useState(false);
  const [invoiceIssueSubmitting, setInvoiceIssueSubmitting] = useState(false);
  const [invoiceImportMessage, setInvoiceImportMessage] = useState('');
  const [editingInvoiceDateId, setEditingInvoiceDateId] = useState<string | null>(null);
  const [editingInvoiceShipDate, setEditingInvoiceShipDate] = useState('');
  const [editingInvoiceReleaseDate, setEditingInvoiceReleaseDate] = useState('');
  const [invoiceDateSaving, setInvoiceDateSaving] = useState(false);
  const invoiceImportInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceCustomerLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invoiceImportTable = useImportResultTable(invoiceImportRows);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    const result = await apiCall(`invoice${params.toString() ? `?${params.toString()}` : ''}`);
    if (result.success) {
      setInvoices(result.data);
    }
    setLoading(false);
  }, [setInvoices, setLoading, search]);

  const downloadInvoiceImportTemplate = async () => {
    try {
      const response = await fetch('/api/invoice?action=import-template', {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(tx('模板下载失败', 'Failed to download template'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'invoice-import-template.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('模板下载失败', 'Failed to download template'));
    }
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
      if (invoiceImportInputRef.current) invoiceImportInputRef.current.value = '';
    }
  };

  const updateInvoiceImportIssue = (rowNo: number, field: keyof Omit<InvoiceImportRowView, 'latestStatus' | 'latestReason' | 'attempts'>, value: string) => {
    setInvoiceImportRows((prev) => prev.map((row) => {
      if (row.rowNo !== rowNo || row.latestStatus !== 'FAILED') return row;
      return { ...row, [field]: value };
    }));
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

  const resetCreateInvoiceDialog = () => {
    setFormError('');
    setInvNo('');
    setShipDate('');
    setReleaseDate('');
    setOrders([{ orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setShowDialog(open);
    if (!open) resetCreateInvoiceDialog();
  };

  const handleOrderDialogOpenChange = (open: boolean) => {
    setShowOrderDialog(open);
    if (!open) {
      setEditingOrder(null);
      setOrderFormError('');
      setEditingOrderCandidates([]);
    }
  };

  const handleTransferDialogOpenChange = (open: boolean) => {
    setShowTransferDialog(open);
    if (!open) {
      setTransferFromOrder(null);
      setTransferToOrderNo('');
      setTransferAmount('');
      setTransferError('');
    }
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

  const openInvoiceDateEditor = (invoiceId: string, currentShipDate?: string | null, currentReleaseDate?: string | null) => {
    setEditingInvoiceDateId(invoiceId);
    setEditingInvoiceShipDate(toDateInputValue(currentShipDate));
    setEditingInvoiceReleaseDate(toDateInputValue(currentReleaseDate));
  };

  const cancelInvoiceDateEditor = () => {
    setEditingInvoiceDateId(null);
    setEditingInvoiceShipDate('');
    setEditingInvoiceReleaseDate('');
  };

  const updateRematchSelection = (groupId: string, value: Partial<RematchSelection>, group: RematchPreviewGroup) => {
    setRematchSelections((prev) => ({
      ...prev,
      [groupId]: {
        keepOrderId: prev[groupId]?.keepOrderId || group.orders[0]?.id || '',
        mode: prev[groupId]?.mode || 'merge',
        orderIds: prev[groupId]?.orderIds || group.orders.map((order) => order.id),
        ...value,
      },
    }));
  };

  const saveInvoiceDates = async () => {
    if (!editingInvoiceDateId) return;
    setInvoiceDateSaving(true);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'updateInvoiceDates',
          invoiceId: editingInvoiceDateId,
          shipDate: editingInvoiceShipDate || '',
          releaseDate: editingInvoiceReleaseDate || '',
        }),
      });
      if (!result.success) {
        alert(result.error || tx('保存失败', 'Save failed'));
        return;
      }
      cancelInvoiceDateEditor();
      await loadInvoices();
    } catch (error) {
      alert(error instanceof Error ? error.message : tx('保存失败', 'Save failed'));
    } finally {
      setInvoiceDateSaving(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    return () => {
      if (invoiceCustomerLookupTimerRef.current) {
        clearTimeout(invoiceCustomerLookupTimerRef.current);
      }
    };
  }, []);

  const loadCustomerCandidates = (
    mark: string,
    setter: (rows: CustomerCandidate[]) => void,
    setDefaultName?: (value: string) => void,
    setDefaultId?: (value: string) => void,
    setDefaultPhone?: (value: string) => void,
    setDefaultCity?: (value: string) => void
  ) => {
    const normalized = mark.trim();
    if (invoiceCustomerLookupTimerRef.current) {
      clearTimeout(invoiceCustomerLookupTimerRef.current);
      invoiceCustomerLookupTimerRef.current = null;
    }
    if (!normalized) {
      setter([]);
      if (setDefaultName) setDefaultName('');
      if (setDefaultId) setDefaultId('');
      return;
    }

    invoiceCustomerLookupTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchCustomerCandidatesByMark(normalized);
          if (!result.success || !Array.isArray(result.data)) {
            setter([]);
            return;
          }
          const rows: CustomerCandidate[] = result.data.map((row) => ({
            id: row.id,
            mark: row.mark,
            orderName: row.orderName || row.name || '',
            displayName: row.name || '',
            phone: row.phone ?? null,
            city: row.city ?? null,
          }));
          setter(rows);
          if (rows.length === 1) {
            if (setDefaultName) setDefaultName(rows[0].orderName);
            if (setDefaultId) setDefaultId(rows[0].id);
            if (setDefaultPhone) setDefaultPhone(rows[0].phone || '');
            if (setDefaultCity) setDefaultCity(rows[0].city || '');
          }
        } catch {
          setter([]);
        }
      })();
    }, 220);
  };

  const openOrderHistory = async (orderId: string, orderNo: string) => {
    try {
      const result = await apiCall(`invoice?orderId=${encodeURIComponent(orderId)}`);
      if (result.success) {
        setOrderHistoryRows(Array.isArray(result.data) ? result.data : []);
        setOrderHistoryTitle(orderNo);
        setOrderHistoryOpen(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : tx('加载付款记录失败', 'Failed to load payment records'));
    }
  };

  const openRematchDialog = async () => {
    setRematchLoading(true);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({ action: 'rematch-preview' }),
      });

      if (result.success) {
        const groups = Array.isArray(result.data) ? result.data : [];
        setRematchGroups(groups);
        const defaultSelections: Record<string, { keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }> = {};
        for (const group of groups) {
          const first = group.orders?.[0];
          if (!first) continue;
          defaultSelections[group.groupId] = {
            keepOrderId: first.id,
            mode: 'merge',
            orderIds: group.orders.map((o: { id: string }) => o.id),
          };
        }
        setRematchSelections(defaultSelections);
        setShowRematchDialog(true);
      } else {
        alert(result.error || tx('刷新失败', 'Rematch failed'));
      }
    } catch (err) {
      alert(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    } finally {
      setRematchLoading(false);
    }
  };

  const handleRematchApply = async () => {
    setApplyingRematch(true);
    try {
      const resolutions = Object.entries(rematchSelections).map(([groupId, selection]) => ({
        groupId,
        keepOrderId: selection.keepOrderId,
        mode: selection.mode,
        orderIds: selection.orderIds,
      }));
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({ action: 'rematch-apply', resolutions }),
      });
      if (!result.success) {
        alert(result.error || tx('应用失败', 'Apply rematch failed'));
        return;
      }
      alert(result.message || tx('刷新成功', 'Rematch completed'));
      setShowRematchDialog(false);
      await loadInvoices();
    } catch (err) {
      alert(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
    } finally {
      setApplyingRematch(false);
    }
  };

  const toggleInvoice = (invoiceId: string) => {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedInvoices(newExpanded);
  };

  const handleCreateInvoice = async () => {
    setFormError('');
    
    if (!invNo.trim()) {
      setFormError(tx('请输入账单号', 'Please enter invoice number.'));
      return;
    }
    if (orders.some((o) => !o.orderNo.trim() || !o.amount || !o.customerMark.trim())) {
      setFormError(tx('请填写所有订单的客户单号、金额和MARK', 'Please fill ORDER, amount and MARK for all rows.'));
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'POST',
        body: JSON.stringify({
          invNo,
          shipDate: shipDate || null,
          releaseDate: releaseDate || null,
          orders: orders.map((o) => ({
            orderNo: o.orderNo,
            amount: parseFloat(o.amount),
            customerMark: o.customerMark,
            customerName: o.customerName || null,
            customerId: o.customerId || null,
          })),
        }),
      });

      if (result.success) {
        setShowDialog(false);
        resetCreateInvoiceDialog();
        // 显示合并消息（如果有）
        if (result.message) {
          alert(result.message);
        }
        loadInvoices();
      } else {
        setFormError(result.error || tx('创建失败', 'Create failed'));
      }
    } catch (err) {
      setFormError(tx('网络错误，请重试', 'Network error, please retry.'));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;
    setOrderFormError('');
    
    if (!editingOrder.orderNo.trim()) {
      setOrderFormError(tx('请输入客户单号', 'Please enter order number.'));
      return;
    }
    
    if (!Number.isFinite(editingOrder.amount) || editingOrder.amount < 0) {
      setOrderFormError(tx('请输入有效金额(>=0)', 'Please enter a valid amount (>=0).'));
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'updateOrder',
          orderId: editingOrder.id,
          orderNo: editingOrder.orderNo,
          amount: editingOrder.amount,
          customerMark: editingOrder.customerMark,
          customerName: editingOrder.customerName || null,
          customerPhone: editingOrder.customerPhone || null,
          customerCity: editingOrder.customerCity || null,
          customerId: editingOrder.customerId || null,
        }),
      });

      if (result.success) {
        handleOrderDialogOpenChange(false);
        loadInvoices();
      } else {
        setOrderFormError(result.error || tx('修改失败', 'Update failed'));
      }
    } catch (err) {
      setOrderFormError(tx('网络错误，请重试', 'Network error, please retry.'));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm(tx('确定要删除这个订单吗？', 'Delete this order?'))) return;
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'deleteOrder',
          orderId
        }),
      });

      if (result.success) {
        loadInvoices();
      } else {
        alert(result.error || tx('删除失败', 'Delete failed'));
      }
    } catch (err) {
      alert(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    }
  };

  const handleAddOrder = async () => {
    if (!addingOrderToInvoice) return;
    setAddError('');
    
    if (!newOrderNo.trim()) {
      setAddError(tx('请输入客户单号', 'Please enter order number.'));
      return;
    }
    
    if (!newOrderAmount || parseFloat(newOrderAmount) <= 0) {
      setAddError(tx('请输入有效金额', 'Please enter a valid amount.'));
      return;
    }
    if (!newOrderCustomerMark.trim()) {
      setAddError(tx('请输入客户MARK', 'Please enter customer MARK.'));
      return;
    }

    setSubmitting(true);
    
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'addOrder',
          invoiceId: addingOrderToInvoice,
          orderNo: newOrderNo,
          amount: parseFloat(newOrderAmount),
          customerMark: newOrderCustomerMark,
          customerName: newOrderCustomerName || null,
          customerId: newOrderCustomerId || null,
        }),
      });

      if (result.success) {
        setAddingOrderToInvoice(null);
        setNewOrderNo('');
        setNewOrderAmount('');
        setNewOrderCustomerMark('');
        setNewOrderCustomerName('');
        setNewOrderCustomerId('');
        setNewOrderCustomerCandidates([]);
        loadInvoices();
      } else {
        setAddError(result.error || tx('添加失败', 'Add failed'));
      }
    } catch (err) {
      setAddError(tx('网络错误，请重试', 'Network error, please retry.'));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // 转移余额
  const handleTransferBalance = async () => {
    if (!transferFromOrder || !transferToOrderNo || !transferAmount) {
      setTransferError(tx('请填写完整信息', 'Please complete all required fields.'));
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError(tx('请输入有效金额', 'Please enter a valid amount.'));
      return;
    }

    setSubmitting(true);
    setTransferError('');

    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'transferBalance',
          fromOrderId: transferFromOrder.id,
          toOrderNo: transferToOrderNo.trim(),
          transferAmount: amount
        })
      });

      if (result.success) {
        alert(result.message);
        handleTransferDialogOpenChange(false);
        loadInvoices();
      } else {
        setTransferError(result.error || tx('转移失败', 'Transfer failed'));
      }
    } catch (err) {
      setTransferError(tx('网络错误，请重试', 'Network error, please retry.'));
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const addOrderRow = () => {
    setOrders([...orders, { orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
  };

  const updateOrder = (index: number, field: 'orderNo' | 'amount' | 'customerMark', value: string) => {
    const newOrders = [...orders];
    if (field === 'customerMark') {
      newOrders[index].customerMark = value;
      newOrders[index].customerId = '';
      newOrders[index].customerName = '';
      loadCustomerCandidates(
        value,
        (rows) => {
          setOrders((prev) => {
            const copy = [...prev];
            const row = copy[index];
            if (!row) return prev;
            row.customerCandidates = rows;
            if (rows.length === 1) {
              row.customerName = rows[0].orderName;
              row.customerId = rows[0].id;
            }
            return copy;
          });
        },
        (name) => setOrders((prev) => {
          const copy = [...prev];
          if (copy[index]) copy[index].customerName = name;
          return copy;
        }),
        (id) => setOrders((prev) => {
          const copy = [...prev];
          if (copy[index]) copy[index].customerId = id;
          return copy;
        })
      );
    } else if (field === 'orderNo') {
      newOrders[index].orderNo = value;
      const orderInput = value.trim();
      if (orderInput) {
        void lookupCustomerByOrderNoGroup(orderInput).then((matched) => {
          if (!matched) return;
          setOrders((prev) => {
            const copy = [...prev];
            const row = copy[index];
            if (!row) return prev;
            row.customerMark = matched.mark;
            row.customerName = matched.name || row.customerName;
            row.customerId = matched.customerId || row.customerId;
            return copy;
          });
          loadCustomerCandidates(
            matched.mark,
            (rows) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerCandidates = rows;
              return copy;
            }),
            (name) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerName = name;
              return copy;
            }),
            (id) => setOrders((prev) => {
              const copy = [...prev];
              if (copy[index]) copy[index].customerId = id;
              return copy;
            })
          );
        });
      }
    } else {
      newOrders[index].amount = value;
    }
    setOrders(newOrders);
  };

  const removeOrder = (index: number) => {
    if (orders.length > 1) {
      setOrders(orders.filter((_, i) => i !== index));
    }
  };

  const selectCreateInvoiceCustomer = (index: number, customerId: string) => {
    setOrders((prev) => {
      const copy = [...prev];
      const row = copy[index];
      if (!row) return prev;
      row.customerId = customerId;
      const selected = row.customerCandidates.find((candidate) => candidate.id === customerId);
      row.customerName = selected?.orderName || '';
      return copy;
    });
  };

  const handleEditingOrderMarkChange = (mark: string) => {
    if (!editingOrder) return;
    setEditingOrder({ ...editingOrder, customerMark: mark, customerName: '', customerPhone: '', customerCity: '', customerId: '' });
    loadCustomerCandidates(
      mark,
      setEditingOrderCandidates,
      (name) => setEditingOrder((prev) => prev ? ({ ...prev, customerName: name }) : prev),
      (id) => setEditingOrder((prev) => prev ? ({ ...prev, customerId: id }) : prev),
      (phone) => setEditingOrder((prev) => prev ? ({ ...prev, customerPhone: phone }) : prev),
      (city) => setEditingOrder((prev) => prev ? ({ ...prev, customerCity: city }) : prev)
    );
  };

  const selectEditingOrderCustomer = (customerId: string) => {
    const selected = editingOrderCandidates.find((candidate) => candidate.id === customerId);
    setEditingOrder((prev) => prev ? ({
      ...prev,
      customerId,
      customerName: selected?.orderName || '',
      customerPhone: selected?.phone || '',
      customerCity: selected?.city || '',
    }) : prev);
  };

  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('账单管理', 'Invoice Management')}</h2>
        <div className="flex gap-2">
          {isManager && (
            <>
              <input
                ref={invoiceImportInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleInvoiceExcelImport(file);
                }}
              />
              <Button variant="outline" onClick={downloadInvoiceImportTemplate}>
                {tx('下载账单模板', 'Download Invoice Template')}
              </Button>
              <Button
                variant="outline"
                disabled={invoiceImporting}
                onClick={() => invoiceImportInputRef.current?.click()}
              >
                {invoiceImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                {tx('批量上传账单', 'Bulk Import Invoices')}
              </Button>
              <Button 
                variant="outline" 
                onClick={openRematchDialog}
                disabled={refreshing || rematchLoading}
              >
                {refreshing || rematchLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {tx('刷新匹配', 'Rematch')}
              </Button>
              <Button onClick={() => setShowDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {tx('直接创建账单', 'Create Invoice')}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            placeholder={tx('搜索 INV NO / ORDER', 'Search INV NO / ORDER')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div />
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setSearch('')}>
              {tx('重置筛选', 'Reset Filters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <InvoiceList
        invoices={invoices}
        expandedInvoices={expandedInvoices}
        isManager={isManager}
        addingOrderToInvoice={addingOrderToInvoice}
        newOrderNo={newOrderNo}
        newOrderAmount={newOrderAmount}
        newOrderCustomerMark={newOrderCustomerMark}
        newOrderCustomerId={newOrderCustomerId}
        newOrderCustomerCandidates={newOrderCustomerCandidates}
        addError={addError}
        editingInvoiceDateId={editingInvoiceDateId}
        editingInvoiceShipDate={editingInvoiceShipDate}
        editingInvoiceReleaseDate={editingInvoiceReleaseDate}
        invoiceDateSaving={invoiceDateSaving}
        submitting={submitting}
        tx={tx}
        onToggleInvoice={toggleInvoice}
        onOpenInvoiceDateEditor={openInvoiceDateEditor}
        onEditingInvoiceShipDateChange={setEditingInvoiceShipDate}
        onEditingInvoiceReleaseDateChange={setEditingInvoiceReleaseDate}
        onClearInvoiceDates={() => {
          setEditingInvoiceShipDate('');
          setEditingInvoiceReleaseDate('');
        }}
        onSaveInvoiceDates={saveInvoiceDates}
        onCancelInvoiceDateEditor={cancelInvoiceDateEditor}
        onStartAddOrder={setAddingOrderToInvoice}
        onNewOrderNoChange={(value) => {
          setNewOrderNo(value);
          if (value.trim()) {
            void lookupCustomerByOrderNoGroup(value).then((matched) => {
              if (!matched) return;
              setNewOrderCustomerMark(matched.mark);
              setNewOrderCustomerName(matched.name);
              setNewOrderCustomerId(matched.customerId);
              loadCustomerCandidates(
                matched.mark,
                setNewOrderCustomerCandidates,
                setNewOrderCustomerName,
                setNewOrderCustomerId
              );
            });
          }
        }}
        onNewOrderAmountChange={setNewOrderAmount}
        onNewOrderCustomerMarkChange={(value) => {
          setNewOrderCustomerMark(value);
          setNewOrderCustomerId('');
          setNewOrderCustomerName('');
          loadCustomerCandidates(
            value,
            setNewOrderCustomerCandidates,
            setNewOrderCustomerName,
            setNewOrderCustomerId
          );
        }}
        onNewOrderCustomerSelect={(customerId) => {
          setNewOrderCustomerId(customerId);
          const selected = newOrderCustomerCandidates.find((candidate) => candidate.id === customerId);
          setNewOrderCustomerName(selected?.orderName || '');
        }}
        onSubmitAddOrder={handleAddOrder}
        onCancelAddOrder={() => {
          setAddingOrderToInvoice(null);
          setNewOrderNo('');
          setNewOrderAmount('');
          setNewOrderCustomerMark('');
          setNewOrderCustomerName('');
          setNewOrderCustomerId('');
          setNewOrderCustomerCandidates([]);
          setAddError('');
        }}
        onOpenOrderHistory={openOrderHistory}
        onOpenTransfer={(order) => {
          setTransferFromOrder(order);
          setTransferAmount(Math.abs(order.balance).toFixed(2));
          setShowTransferDialog(true);
        }}
        onOpenEditOrder={(invoiceId, order) => {
          setEditingOrder({
            id: order.id,
            orderNo: order.orderNo,
            amount: order.amount,
            invoiceId,
            customerMark: order.customerMark || '',
            customerName: order.customerName || '',
            customerPhone: order.customerPhone || '',
            customerCity: order.customerCity || '',
            customerId: '',
          });
          setEditingOrderCandidates([]);
          if (order.customerMark) {
            loadCustomerCandidates(
              order.customerMark,
              setEditingOrderCandidates,
              undefined,
              undefined,
              undefined,
              undefined
            );
          }
          setShowOrderDialog(true);
        }}
        onDeleteOrder={handleDeleteOrder}
      />

      <CreateInvoiceDialog
        open={showDialog}
        submitting={submitting}
        formError={formError}
        invNo={invNo}
        shipDate={shipDate}
        releaseDate={releaseDate}
        orders={orders}
        tx={tx}
        onOpenChange={handleCreateDialogOpenChange}
        onInvNoChange={setInvNo}
        onShipDateChange={setShipDate}
        onReleaseDateChange={setReleaseDate}
        onOrderChange={updateOrder}
        onOrderCustomerSelect={selectCreateInvoiceCustomer}
        onAddOrderRow={addOrderRow}
        onRemoveOrder={removeOrder}
        onSubmit={handleCreateInvoice}
      />

      <EditOrderDialog
        open={showOrderDialog}
        submitting={submitting}
        error={orderFormError}
        order={editingOrder}
        candidates={editingOrderCandidates}
        tx={tx}
        onOpenChange={handleOrderDialogOpenChange}
        onOrderChange={setEditingOrder}
        onMarkChange={handleEditingOrderMarkChange}
        onCandidateSelect={selectEditingOrderCustomer}
        onSubmit={handleUpdateOrder}
      />

      <TransferBalanceDialog
        open={showTransferDialog}
        submitting={submitting}
        error={transferError}
        transferFromOrder={transferFromOrder}
        transferToOrderNo={transferToOrderNo}
        transferAmount={transferAmount}
        tx={tx}
        onOpenChange={handleTransferDialogOpenChange}
        onTransferToOrderNoChange={setTransferToOrderNo}
        onTransferAmountChange={setTransferAmount}
        onSubmit={handleTransferBalance}
      />

      <OrderHistoryDialog
        open={orderHistoryOpen}
        title={orderHistoryTitle}
        rows={orderHistoryRows}
        tx={tx}
        onOpenChange={setOrderHistoryOpen}
      />

      <ImportResultDialog
        open={showInvoiceImportIssues}
        onOpenChange={(open) => { if (!open) closeInvoiceImportDialog(); else setShowInvoiceImportIssues(true); }}
        title={tx('账单导入问题行处理', 'Invoice Import Issue Rows')}
        description={invoiceImportMessage || tx('请查看导入结果，失败行可编辑后重试。', 'Check import results. Failed rows can be edited and retried.')}
        filter={invoiceImportTable.filter}
        onFilterChange={invoiceImportTable.setFilter}
        rows={invoiceImportTable.pagedRows}
        columns={invoiceImportColumns}
        attemptCount={invoiceImportTable.attemptCount}
        page={invoiceImportTable.page}
        totalPages={invoiceImportTable.totalPages}
        onPageChange={invoiceImportTable.setPage}
        onClose={closeInvoiceImportDialog}
        onRetry={retryInvoiceIssueRows}
        retrying={invoiceIssueSubmitting}
        retryDisabled={invoiceImportTable.latestFailedRows.length === 0}
      />

      <RematchDialog
        open={showRematchDialog}
        groups={rematchGroups}
        selections={rematchSelections}
        applying={applyingRematch}
        tx={tx}
        onOpenChange={setShowRematchDialog}
        onSelectionChange={updateRematchSelection}
        onApply={handleRematchApply}
      />
    </div>
  );
}
