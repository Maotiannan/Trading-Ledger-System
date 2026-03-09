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
  IMPORT_RESULT_PAGE_SIZE,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type CustomerImportIssueRow,
  type CustomerImportRowResult,
  type CustomerImportRowView,
  type InvoiceImportIssueRow,
  type InvoiceImportRowResult,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import {
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye,
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

export function InvoiceManager() {
  const tx = useUiText();
  const { invoices, setInvoices, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [invNo, setInvNo] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [orders, setOrders] = useState<Array<{
    orderNo: string;
    amount: string;
    customerMark: string;
    customerName: string;
    customerId: string;
    customerCandidates: CustomerCandidate[];
  }>>([{ orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 展开状态
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  
  // 编辑订单对话框
  const [editingOrder, setEditingOrder] = useState<{
    id: string;
    orderNo: string;
    amount: number;
    invoiceId: string;
    customerMark: string;
    customerName: string;
    customerPhone: string;
    customerCity: string;
    customerId: string;
  } | null>(null);
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
  const [transferFromOrder, setTransferFromOrder] = useState<{ id: string; orderNo: string; balance: number } | null>(null);
  const [transferToOrderNo, setTransferToOrderNo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  
  // 刷新匹配状态
  const [refreshing, setRefreshing] = useState(false);
  const [showRematchDialog, setShowRematchDialog] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [applyingRematch, setApplyingRematch] = useState(false);
  const [rematchGroups, setRematchGroups] = useState<Array<{
    groupId: string;
    groupType: 'exact' | 'customer-group';
    groupKey: string;
    orders: Array<{
      id: string;
      invNo: string;
      orderNo: string;
      amount: number;
      orderBalance: number;
      receiptCount: number;
      createdAt: string;
    }>;
  }>>([]);
  const [rematchSelections, setRematchSelections] = useState<Record<string, { keepOrderId: string; mode: 'keep' | 'merge'; orderIds: string[] }>>({});
  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [orderHistoryTitle, setOrderHistoryTitle] = useState('');
  const [orderHistoryRows, setOrderHistoryRows] = useState<Array<Record<string, unknown>>>([]);
  const [editingOrderCandidates, setEditingOrderCandidates] = useState<CustomerCandidate[]>([]);
  const [invoiceImporting, setInvoiceImporting] = useState(false);
  const [invoiceImportRows, setInvoiceImportRows] = useState<InvoiceImportRowView[]>([]);
  const [showInvoiceImportIssues, setShowInvoiceImportIssues] = useState(false);
  const [invoiceIssueSubmitting, setInvoiceIssueSubmitting] = useState(false);
  const [invoiceImportMessage, setInvoiceImportMessage] = useState('');
  const [invoiceImportFilter, setInvoiceImportFilter] = useState<'failed' | 'all'>('failed');
  const [invoiceImportPage, setInvoiceImportPage] = useState(1);
  const [editingInvoiceDateId, setEditingInvoiceDateId] = useState<string | null>(null);
  const [editingInvoiceShipDate, setEditingInvoiceShipDate] = useState('');
  const [editingInvoiceReleaseDate, setEditingInvoiceReleaseDate] = useState('');
  const [invoiceDateSaving, setInvoiceDateSaving] = useState(false);
  const invoiceImportInputRef = useRef<HTMLInputElement | null>(null);
  const invoiceCustomerLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setInvoiceImportFilter('failed');
      setInvoiceImportPage(1);
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

  const latestFailedInvoiceRows = useMemo(
    () => invoiceImportRows.filter((row) => row.latestStatus === 'FAILED'),
    [invoiceImportRows]
  );
  const invoiceAttemptCount = useMemo(
    () => invoiceImportRows.reduce((max, row) => Math.max(max, row.attempts.length), 0),
    [invoiceImportRows]
  );
  const visibleInvoiceImportRows = useMemo(() => {
    if (invoiceImportFilter === 'failed') return latestFailedInvoiceRows;
    return invoiceImportRows;
  }, [invoiceImportFilter, latestFailedInvoiceRows, invoiceImportRows]);
  const invoiceImportTotalPages = Math.max(1, Math.ceil(visibleInvoiceImportRows.length / IMPORT_RESULT_PAGE_SIZE));
  const pagedInvoiceImportRows = useMemo(() => {
    const start = (invoiceImportPage - 1) * IMPORT_RESULT_PAGE_SIZE;
    return visibleInvoiceImportRows.slice(start, start + IMPORT_RESULT_PAGE_SIZE);
  }, [visibleInvoiceImportRows, invoiceImportPage]);

  useEffect(() => {
    if (invoiceImportPage > invoiceImportTotalPages) {
      setInvoiceImportPage(invoiceImportTotalPages);
    }
  }, [invoiceImportPage, invoiceImportTotalPages]);

  useEffect(() => {
    setInvoiceImportPage(1);
  }, [invoiceImportFilter]);

  const retryInvoiceIssueRows = async () => {
    if (latestFailedInvoiceRows.length === 0) return;
    setInvoiceIssueSubmitting(true);
    try {
      const response = await fetch('/api/invoice', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import-rows',
          rows: latestFailedInvoiceRows.map((row) => ({
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
    setInvoiceImportFilter('failed');
    setInvoiceImportPage(1);
  };

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
        setInvNo('');
        setShipDate('');
        setReleaseDate('');
        setOrders([{ orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
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
        setShowOrderDialog(false);
        setEditingOrder(null);
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
        setShowTransferDialog(false);
        setTransferFromOrder(null);
        setTransferToOrderNo('');
        setTransferAmount('');
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

      <div className="space-y-4">
        {invoices.map((invoice) => (
          <Card key={invoice.id}>
            <CardHeader 
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => toggleInvoice(invoice.id)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  {expandedInvoices.has(invoice.id) ? (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-500" />
                  )}
                  <div>
                    <CardTitle className="text-lg">{invoice.invNo}</CardTitle>
                    <CardDescription>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{tx(`${invoice.orders.length} 个订单`, `${invoice.orders.length} orders`)}</span>
                        {editingInvoiceDateId === invoice.id ? (
                          <div
                            className="flex flex-wrap items-center gap-2"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span>{tx('发货', 'SHIP')}</span>
                            <Input
                              type="date"
                              value={editingInvoiceShipDate}
                              onChange={(event) => setEditingInvoiceShipDate(event.target.value)}
                              className="h-8 w-[150px]"
                            />
                            <span>{tx('放货', 'RELEASE')}</span>
                            <Input
                              type="date"
                              value={editingInvoiceReleaseDate}
                              onChange={(event) => setEditingInvoiceReleaseDate(event.target.value)}
                              className="h-8 w-[150px]"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingInvoiceShipDate('');
                                setEditingInvoiceReleaseDate('');
                              }}
                            >
                              {tx('清空', 'Clear')}
                            </Button>
                            <Button size="sm" onClick={saveInvoiceDates} disabled={invoiceDateSaving}>
                              {invoiceDateSaving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                              {tx('保存', 'Save')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={cancelInvoiceDateEditor} disabled={invoiceDateSaving}>
                              {tx('取消', 'Cancel')}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <span>{`${tx('发货', 'SHIP')}: ${invoice.shipDate ? new Date(invoice.shipDate).toLocaleDateString() : '-'}`}</span>
                            <span>{`${tx('放货', 'RELEASE')}: ${invoice.releaseDate ? new Date(invoice.releaseDate).toLocaleDateString() : '-'}`}</span>
                            {isManager && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openInvoiceDateEditor(invoice.id, invoice.shipDate, invoice.releaseDate);
                                }}
                                className="h-7 px-2"
                              >
                                <Pencil className="h-3.5 w-3.5 mr-1" />
                                {tx('编辑日期', 'Edit Dates')}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-gray-500">{tx('总金额', 'Total Amount')}</div>
                    <div className="font-semibold">${invoice.invAmount.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500">{tx('未收金额', 'Outstanding')}</div>
                    <div className={`font-semibold ${invoice.invBalance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      ${invoice.invBalance.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            
            {expandedInvoices.has(invoice.id) && (
              <CardContent className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-medium">{tx('订单明细', 'Order Details')}</h4>
                  {isManager && (
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setAddingOrderToInvoice(invoice.id)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {tx('添加订单', 'Add Order')}
                    </Button>
                  )}
                </div>
                
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tx('客户单号 (ORDER)', 'Order No. (ORDER)')}</TableHead>
                      <TableHead>MARK</TableHead>
                      <TableHead>{tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}</TableHead>
                      <TableHead>{tx('未收金额', 'Outstanding')}</TableHead>
                      {isManager && <TableHead className="text-right">{tx('操作', 'Actions')}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.orders.map((order) => {
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className={`underline ${order.needsCustomerFix ? 'text-red-600' : 'text-blue-600'}`}
                              onClick={() => openOrderHistory(order.id, order.orderNo)}
                            >
                              {order.orderNo}
                            </button>
                            {order.needsCustomerFix && (
                              <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {order.customerMark || '-'}
                          </TableCell>
                          <TableCell>
                            ${order.amount.toFixed(2)}
                          </TableCell>
                          <TableCell className={order.orderBalance > 0 ? 'text-red-500' : 'text-green-500'}>
                            ${Math.abs(order.orderBalance).toFixed(2)}
                            {order.orderBalance < 0 && <span className="ml-1 text-xs">{tx('(多付)', '(Overpaid)')}</span>}
                          </TableCell>
                          {isManager && (
                            <TableCell className="text-right">
                              {order.orderBalance < 0 && (
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  onClick={() => {
                                    setTransferFromOrder({
                                      id: order.id,
                                      orderNo: order.orderNo,
                                      balance: order.orderBalance
                                    });
                                    setTransferAmount(Math.abs(order.orderBalance).toFixed(2));
                                    setShowTransferDialog(true);
                                  }}
                                  title={tx('转移多付金额', 'Transfer Overpayment')}
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  <ArrowRight className="h-4 w-4" />
                                </Button>
                              )}
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => {
                                  setEditingOrder({
                                    id: order.id,
                                    orderNo: order.orderNo,
                                    amount: order.amount,
                                    invoiceId: invoice.id,
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
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => handleDeleteOrder(order.id)}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {invoice.orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isManager ? 5 : 4} className="text-center py-4 text-gray-500">
                          {tx('暂无订单', 'No orders')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                
                {/* 添加订单表单 */}
                {addingOrderToInvoice === invoice.id && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                    <h5 className="font-medium mb-3">{tx('添加新订单', 'Add New Order')}</h5>
                    {addError && (
                      <Alert variant="destructive" className="mb-3">
                        <AlertDescription>{addError}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-3">
                      <Input
                        placeholder={tx('客户单号', 'Order number')}
                        value={newOrderNo}
                        onChange={(e) => {
                          const value = e.target.value;
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
                        className="flex-1"
                      />
                      <Input
                        placeholder={tx('金额', 'Amount')}
                        type="number"
                        value={newOrderAmount}
                        onChange={(e) => setNewOrderAmount(e.target.value)}
                        className="w-32"
                      />
                      <Input
                        placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')}
                        value={newOrderCustomerMark}
                        onChange={(e) => {
                          const value = e.target.value;
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
                        className="w-44"
                      />
                      {newOrderCustomerCandidates.length > 1 && (
                        <select
                          className="border rounded-md px-2 py-2 text-sm"
                          value={newOrderCustomerId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setNewOrderCustomerId(id);
                            const selected = newOrderCustomerCandidates.find((c) => c.id === id);
                            setNewOrderCustomerName(selected?.orderName || '');
                          }}
                        >
                          <option value="">{tx('选择客户', 'Select customer')}</option>
                          {newOrderCustomerCandidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.mark}/{candidate.orderName}</option>
                          ))}
                        </select>
                      )}
                      <Button onClick={handleAddOrder} disabled={submitting}>
                        {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                        {tx('添加', 'Add')}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setAddingOrderToInvoice(null);
                          setNewOrderNo('');
                          setNewOrderAmount('');
                          setNewOrderCustomerMark('');
                          setNewOrderCustomerName('');
                          setNewOrderCustomerId('');
                          setNewOrderCustomerCandidates([]);
                          setAddError('');
                        }}
                      >
                        {tx('取消', 'Cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
        
        {invoices.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              {tx('暂无账单', 'No invoices')}
            </CardContent>
          </Card>
        )}
      </div>

      {/* 创建账单对话框 */}
      <Dialog open={showDialog} onOpenChange={(open) => {
        setShowDialog(open);
        if (!open) {
          setFormError('');
          setInvNo('');
          setShipDate('');
          setReleaseDate('');
          setOrders([{ orderNo: '', amount: '', customerMark: '', customerName: '', customerId: '', customerCandidates: [] }]);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[calc(100vh-40px)] flex flex-col">
          <DialogHeader>
            <DialogTitle>{tx('创建账单', 'Create Invoice')}</DialogTitle>
            <DialogDescription>{tx('创建新账单并添加订单', 'Create a new invoice and add orders')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-2">
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>{tx('账单号 (INV NO)', 'Invoice No. (INV NO)')}</Label>
              <Input value={invNo} onChange={(e) => setInvNo(e.target.value)} placeholder={tx('如: L25MH090125', 'e.g. L25MH090125')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{tx('发货日期 (SHIP_DATE)', 'SHIP_DATE')}</Label>
                <Input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tx('放货日期 (RELEASE_DATE)', 'RELEASE_DATE')}</Label>
                <Input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{tx('订单列表', 'Order List')}</Label>
              {orders.map((order, index) => (
                <div key={index} className="space-y-2 border rounded-md p-2">
                  <div className="flex gap-2">
                  <Input
                    placeholder={tx('客户单号 (ORDER)', 'Order No. (ORDER)')}
                    value={order.orderNo}
                    onChange={(e) => updateOrder(index, 'orderNo', e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder={tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}
                    type="number"
                    value={order.amount}
                    onChange={(e) => updateOrder(index, 'amount', e.target.value)}
                    className="w-32"
                  />
                    <Input
                      placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')}
                      value={order.customerMark}
                      onChange={(e) => updateOrder(index, 'customerMark', e.target.value)}
                      className="w-44"
                    />
                  {orders.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeOrder(index)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                  {order.customerCandidates.length > 1 && (
                    <select
                      className="w-full border rounded-md px-3 py-2 text-sm"
                      value={order.customerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setOrders((prev) => {
                          const copy = [...prev];
                          const row = copy[index];
                          if (!row) return prev;
                          row.customerId = id;
                          const selected = row.customerCandidates.find((c) => c.id === id);
                          row.customerName = selected?.orderName || '';
                          return copy;
                        });
                      }}
                    >
                      <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
                      {order.customerCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.orderName}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              <Button variant="outline" onClick={addOrderRow} className="w-full">
                <Plus className="h-4 w-4 mr-2" /> {tx('添加订单', 'Add Order')}
              </Button>
            </div>
          </div>
          <DialogFooter className="border-t pt-4 bg-background sticky bottom-0">
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleCreateInvoice} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {tx('创建', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑订单对话框 */}
      <Dialog open={showOrderDialog} onOpenChange={(open) => { setShowOrderDialog(open); if (!open) { setEditingOrder(null); setOrderFormError(''); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('编辑订单', 'Edit Order')}</DialogTitle>
            <DialogDescription>{tx('修改订单信息', 'Update order information')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {orderFormError && (
              <Alert variant="destructive">
                <AlertDescription>{orderFormError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>{tx('客户单号 (ORDER)', 'Order No. (ORDER)')}</Label>
              <Input 
                value={editingOrder?.orderNo || ''} 
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, orderNo: e.target.value })} 
              />
            </div>
            <div className="space-y-2">
              <Label>{tx('金额 (AMOUNT)', 'Amount (AMOUNT)')}</Label>
              <Input 
                type="number"
                value={editingOrder?.amount || ''} 
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, amount: parseFloat(e.target.value) || 0 })} 
              />
            </div>
            <div className="space-y-2">
              <Label>{tx('客户MARK', 'Customer MARK')}</Label>
              <Input
                value={editingOrder?.customerMark || ''}
                onChange={(e) => {
                  if (!editingOrder) return;
                  const mark = e.target.value;
                  setEditingOrder({ ...editingOrder, customerMark: mark, customerName: '', customerPhone: '', customerCity: '', customerId: '' });
                  loadCustomerCandidates(
                    mark,
                    setEditingOrderCandidates,
                    (name) => setEditingOrder((prev) => prev ? ({ ...prev, customerName: name }) : prev),
                    (id) => setEditingOrder((prev) => prev ? ({ ...prev, customerId: id }) : prev),
                    (phone) => setEditingOrder((prev) => prev ? ({ ...prev, customerPhone: phone }) : prev),
                    (city) => setEditingOrder((prev) => prev ? ({ ...prev, customerCity: city }) : prev)
                  );
                }}
              />
            </div>
            {editingOrderCandidates.length > 1 && (
              <div className="space-y-2">
                <Label>{tx('选择客户', 'Select Customer')}</Label>
                <select
                  className="w-full border rounded-md px-3 py-2 text-sm"
                  value={editingOrder?.customerId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    const selected = editingOrderCandidates.find((c) => c.id === id);
                    setEditingOrder((prev) => prev ? ({
                      ...prev,
                      customerId: id,
                      customerName: selected?.orderName || '',
                      customerPhone: selected?.phone || '',
                      customerCity: selected?.city || '',
                    }) : prev);
                  }}
                >
                  <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
                  {editingOrderCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.orderName}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>{tx('客户ORDER_NAME', 'Customer ORDER_NAME')}</Label>
              <Input
                value={editingOrder?.customerName || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tx('客户PHONE', 'Customer PHONE')}</Label>
              <Input
                value={editingOrder?.customerPhone || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerPhone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{tx('客户CITY', 'Customer CITY')}</Label>
              <Input
                value={editingOrder?.customerCity || ''}
                onChange={(e) => editingOrder && setEditingOrder({ ...editingOrder, customerCity: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOrderDialog(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleUpdateOrder} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {tx('保存', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转移余额对话框 */}
      <Dialog open={showTransferDialog} onOpenChange={(open) => { setShowTransferDialog(open); if (!open) { setTransferFromOrder(null); setTransferToOrderNo(''); setTransferAmount(''); setTransferError(''); }}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('转移多付余额', 'Transfer Overpayment')}</DialogTitle>
            <DialogDescription>
              {tx('将订单', 'Transfer overpayment from order')} <strong>{transferFromOrder?.orderNo}</strong> {tx('的多付金额转移到其他订单', 'to another order')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {transferError && (
              <Alert variant="destructive">
                <AlertDescription>{transferError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>{tx('当前多付金额', 'Current overpayment')}</Label>
              <div className="text-green-600 font-bold text-lg">
                ${Math.abs(transferFromOrder?.balance || 0).toFixed(2)}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{tx('目标订单号', 'Target order number')}</Label>
              <Input 
                placeholder={tx('输入目标订单号', 'Enter target order number')}
                value={transferToOrderNo} 
                onChange={(e) => setTransferToOrderNo(e.target.value)} 
              />
              <p className="text-xs text-gray-500">{tx('如果订单不存在，将创建到 Un_Associated 账单', 'If target order does not exist, it will be created under Un_Associated invoice.')}</p>
            </div>
            <div className="space-y-2">
              <Label>{tx('转移金额', 'Transfer amount')}</Label>
              <Input 
                type="number"
                step="0.01"
                value={transferAmount} 
                onChange={(e) => setTransferAmount(e.target.value)} 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransferDialog(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleTransferBalance} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {tx('确认转移', 'Confirm Transfer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orderHistoryOpen} onOpenChange={setOrderHistoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tx('ORDER 付款记录', 'ORDER Payment Records')}</DialogTitle>
            <DialogDescription>{orderHistoryTitle}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
                  <TableHead>{tx('金额', 'Amount')}</TableHead>
                  <TableHead>{tx('状态', 'Status')}</TableHead>
                  <TableHead>{tx('日期', 'Date')}</TableHead>
                  <TableHead>{tx('创建时间', 'Created At')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderHistoryRows.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell>{(row.receiptNo as string) || '-'}</TableCell>
                    <TableCell>${Number(row.usd || 0).toFixed(2)}</TableCell>
                    <TableCell><Badge>{String(row.status || '-')}</Badge></TableCell>
                    <TableCell>{row.date ? new Date(String(row.date)).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>{row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))}
                {orderHistoryRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-gray-500">{tx('暂无付款记录', 'No payment records')}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showInvoiceImportIssues} onOpenChange={(open) => { if (!open) closeInvoiceImportDialog(); else setShowInvoiceImportIssues(true); }}>
        <DialogContent className="!top-[5px] !left-[5px] !translate-x-0 !translate-y-0 !w-[calc(100vw-10px)] !max-w-none !h-[calc(100vh-10px)] flex flex-col p-4">
          <DialogHeader>
            <DialogTitle>{tx('账单导入问题行处理', 'Invoice Import Issue Rows')}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words">
              {invoiceImportMessage || tx('请查看导入结果，失败行可编辑后重试。', 'Check import results. Failed rows can be edited and retried.')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="text-gray-600">
              {tx('默认仅看最新失败行，可切换查看全部。', 'Default view shows latest failed rows. Switch to view all rows.')}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 border rounded-md px-2 bg-white"
                value={invoiceImportFilter}
                onChange={(e) => setInvoiceImportFilter(e.target.value === 'all' ? 'all' : 'failed')}
              >
                <option value="failed">{tx('仅看失败', 'Failed Only')}</option>
                <option value="all">{tx('查看全部', 'All Rows')}</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-auto border rounded-md">
            <Table className="min-w-[2600px] table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead className="min-w-[220px]">INV_NO</TableHead>
                  <TableHead className="min-w-[300px]">ORDER_NO</TableHead>
                  <TableHead className="min-w-[140px]">AMOUNT</TableHead>
                  <TableHead className="min-w-[280px]">CUSTOMER_MARK</TableHead>
                  <TableHead className="min-w-[320px]">CUSTOMER_ORDER_NAME</TableHead>
                  <TableHead className="min-w-[180px]">SHIP_DATE</TableHead>
                  <TableHead className="min-w-[180px]">RELEASE_DATE</TableHead>
                  <TableHead className="min-w-[180px]">{tx('最新状态', 'Latest Status')}</TableHead>
                  <TableHead className="min-w-[540px]">{tx('最新原因', 'Latest Reason')}</TableHead>
                  {Array.from({ length: invoiceAttemptCount }).map((_, idx) => (
                    <TableHead key={`invoice-attempt-${idx}`} className="min-w-[140px]">
                      {`Result#${idx + 1}`}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedInvoiceImportRows.map((row, index) => {
                  const canEdit = row.latestStatus === 'FAILED';
                  return (
                  <TableRow key={`${row.rowNo}-${index}`}>
                    <TableCell>{row.rowNo || index + 1}</TableCell>
                    <TableCell><Input className="min-w-[220px]" value={row.invNo} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'invNo', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[300px]" value={row.orderNo} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'orderNo', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[140px]" value={row.amount} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'amount', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[280px]" value={row.customerMark} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'customerMark', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[320px]" value={row.customerName} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'customerName', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[180px]" value={row.shipDate} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'shipDate', e.target.value)} /></TableCell>
                    <TableCell><Input className="min-w-[180px]" value={row.releaseDate} disabled={!canEdit} onChange={(e) => updateInvoiceImportIssue(row.rowNo, 'releaseDate', e.target.value)} /></TableCell>
                    <TableCell className={row.latestStatus === 'FAILED' ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {row.latestStatus}
                    </TableCell>
                    <TableCell className="min-w-[540px] whitespace-pre-wrap break-words text-xs">
                      {row.latestReason || '-'}
                    </TableCell>
                    {Array.from({ length: invoiceAttemptCount }).map((_, idx) => (
                      <TableCell key={`invoice-row-${row.rowNo}-attempt-${idx}`} className="text-xs">
                        {row.attempts[idx]?.status || '-'}
                      </TableCell>
                    ))}
                  </TableRow>
                  );
                })}
                {pagedInvoiceImportRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10 + invoiceAttemptCount} className="text-center text-gray-500">
                      {invoiceImportFilter === 'failed'
                        ? tx('当前没有最新失败行，可切换“查看全部”', 'No latest failed rows. Switch to "All Rows".')
                        : tx('暂无导入结果', 'No import results')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="text-gray-600">
              {tx('每页 50 行', '50 rows per page')} · {tx('第', 'Page')} {invoiceImportPage} / {invoiceImportTotalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setInvoiceImportPage((p) => Math.max(1, p - 1))}
                disabled={invoiceImportPage <= 1}
              >
                {tx('上一页', 'Prev')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setInvoiceImportPage((p) => Math.min(invoiceImportTotalPages, p + 1))}
                disabled={invoiceImportPage >= invoiceImportTotalPages}
              >
                {tx('下一页', 'Next')}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeInvoiceImportDialog}>
              {tx('关闭', 'Close')}
            </Button>
            <Button onClick={retryInvoiceIssueRows} disabled={invoiceIssueSubmitting || latestFailedInvoiceRows.length === 0}>
              {invoiceIssueSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tx('仅重试失败行', 'Retry Failed Rows')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRematchDialog} onOpenChange={setShowRematchDialog}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{tx('冲突匹配处理', 'Conflict Match Resolution')}</DialogTitle>
            <DialogDescription>{tx('逐组选择保留订单与处理方式，再执行刷新匹配。', 'Choose keeper and strategy for each group before applying rematch.')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-auto">
            {rematchGroups.map((group) => (
              <Card key={group.groupId}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {group.groupType === 'exact' ? tx('同订单号冲突', 'Exact order conflict') : tx('同客组冲突', 'Customer-group conflict')} - {group.groupKey}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <select
                      className="border rounded-md px-3 py-2 text-sm"
                      value={rematchSelections[group.groupId]?.keepOrderId || ''}
                      onChange={(e) => setRematchSelections((prev) => ({
                        ...prev,
                        [group.groupId]: {
                          ...(prev[group.groupId] || { mode: 'merge', orderIds: group.orders.map((o) => o.id) }),
                          keepOrderId: e.target.value,
                        },
                      }))}
                    >
                      {group.orders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.invNo} / {order.orderNo} / ${order.amount.toFixed(2)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="border rounded-md px-3 py-2 text-sm"
                      value={rematchSelections[group.groupId]?.mode || 'merge'}
                      onChange={(e) => setRematchSelections((prev) => ({
                        ...prev,
                        [group.groupId]: {
                          ...(prev[group.groupId] || { keepOrderId: group.orders[0]?.id || '', orderIds: group.orders.map((o) => o.id) }),
                          mode: e.target.value as 'keep' | 'merge',
                        },
                      }))}
                    >
                      <option value="merge">{tx('累加金额并删除其余', 'Merge amounts and delete others')}</option>
                      <option value="keep">{tx('仅保留主订单并删除其余', 'Keep selected order and delete others')}</option>
                    </select>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>INV</TableHead>
                        <TableHead>ORDER</TableHead>
                        <TableHead>{tx('金额', 'Amount')}</TableHead>
                        <TableHead>{tx('余额', 'Balance')}</TableHead>
                        <TableHead>{tx('收据数', 'Receipts')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell>{order.invNo}</TableCell>
                          <TableCell>{order.orderNo}</TableCell>
                          <TableCell>${order.amount.toFixed(2)}</TableCell>
                          <TableCell>${order.orderBalance.toFixed(2)}</TableCell>
                          <TableCell>{order.receiptCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
            {rematchGroups.length === 0 && (
              <div className="text-sm text-gray-500">{tx('未发现冲突组，可直接执行自动刷新匹配。', 'No conflict groups found; automatic rematch will still run.')}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRematchDialog(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleRematchApply} disabled={applyingRematch}>
              {applyingRematch && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tx('确认执行', 'Apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

