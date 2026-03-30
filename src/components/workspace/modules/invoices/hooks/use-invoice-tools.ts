'use client';

import { useCallback, useState } from 'react';
import { apiCall, getErrorMessage, toDateInputValue } from '@/components/workspace/shared';
import type { User } from '@/lib/store';
import type { BranchAdminOption, RematchPreviewGroup, RematchSelection, TransferFromOrder } from '../types';

export type InvoiceToolText = (zh: string, en: string) => string;

function collectDescendantAdminOptions(rows: Array<BranchAdminOption>, currentUserId: string): BranchAdminOption[] {
  const childrenByParent = new Map<string, BranchAdminOption[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    if (!childrenByParent.has(row.parentId)) childrenByParent.set(row.parentId, []);
    childrenByParent.get(row.parentId)!.push(row);
  }

  const descendantIds = new Set<string>();
  const stack = [...(childrenByParent.get(currentUserId) || [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (descendantIds.has(current.id)) continue;
    descendantIds.add(current.id);
    const children = childrenByParent.get(current.id) || [];
    stack.push(...children);
  }

  return rows.filter((row) => row.id !== currentUserId && descendantIds.has(row.id));
}

export function useInvoiceTools(tx: InvoiceToolText, loadInvoices: () => Promise<void>, currentUser: User | null) {
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferFromOrder, setTransferFromOrder] = useState<TransferFromOrder | null>(null);
  const [transferToOrderNo, setTransferToOrderNo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const [showRematchDialog, setShowRematchDialog] = useState(false);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [applyingRematch, setApplyingRematch] = useState(false);
  const [rematchGroups, setRematchGroups] = useState<RematchPreviewGroup[]>([]);
  const [rematchSelections, setRematchSelections] = useState<Record<string, RematchSelection>>({});

  const [orderHistoryOpen, setOrderHistoryOpen] = useState(false);
  const [orderHistoryTitle, setOrderHistoryTitle] = useState('');
  const [orderHistoryRows, setOrderHistoryRows] = useState<Array<Record<string, unknown>>>([]);

  const [editingInvoiceDateId, setEditingInvoiceDateId] = useState<string | null>(null);
  const [editingInvoiceShipDate, setEditingInvoiceShipDate] = useState('');
  const [editingInvoiceReleaseDate, setEditingInvoiceReleaseDate] = useState('');
  const [invoiceDateSaving, setInvoiceDateSaving] = useState(false);
  const [branchAdminOptions, setBranchAdminOptions] = useState<BranchAdminOption[]>([]);
  const [branchAdminLoading, setBranchAdminLoading] = useState(false);
  const [assigningInvoiceId, setAssigningInvoiceId] = useState<string | null>(null);
  const [invoiceBranchAdminSelections, setInvoiceBranchAdminSelections] = useState<Record<string, string>>({});

  const loadBranchAdminOptions = useCallback(async () => {
    if (currentUser?.role !== 'ADMIN') {
      setBranchAdminOptions([]);
      return;
    }
    setBranchAdminLoading(true);
    try {
      const result = await apiCall('auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'list' }),
      });
      if (!result.success) {
        throw new Error(getErrorMessage(result, tx('加载分支管理员失败', 'Failed to load branch admin options')));
      }
      const rows = Array.isArray(result.data) ? result.data : [];
      const adminRows = rows
        .filter((row): row is BranchAdminOption & { role: string } => Boolean(row?.id) && row?.role === 'ADMIN')
        .map((row) => ({
          id: String(row.id),
          email: String(row.email || ''),
          name: typeof row.name === 'string' || row.name === null ? row.name : null,
          level: typeof row.level === 'number' ? row.level : undefined,
          parentId: typeof row.parentId === 'string' || row.parentId === null ? row.parentId : null,
        }));
      setBranchAdminOptions(collectDescendantAdminOptions(adminRows, currentUser.id));
    } catch (error) {
      console.error(error);
      setBranchAdminOptions([]);
    } finally {
      setBranchAdminLoading(false);
    }
  }, [currentUser?.id, currentUser?.role, tx]);

  const selectInvoiceBranchAdmin = (invoiceId: string, targetAdminId: string) => {
    setInvoiceBranchAdminSelections((prev) => ({
      ...prev,
      [invoiceId]: targetAdminId,
    }));
  };

  const assignInvoiceBranchAdmin = async (invoiceId: string) => {
    const targetAdminId = invoiceBranchAdminSelections[invoiceId];
    if (!targetAdminId) {
      alert(tx('请先选择分支管理员', 'Please select a branch admin first.'));
      return;
    }

    setAssigningInvoiceId(invoiceId);
    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'assignBranchAdmin',
          invoiceId,
          targetAdminId,
        }),
      });
      if (!result.success) {
        alert(getErrorMessage(result, tx('分配失败', 'Assignment failed')));
        return;
      }
      alert(result.message || tx('账单归属已分配', 'Invoice ownership assigned.'));
      await loadInvoices();
    } catch (error) {
      alert(getErrorMessage(error, tx('网络错误，请重试', 'Network error, please retry.')));
    } finally {
      setAssigningInvoiceId(null);
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

  const openTransferDialog = (order: TransferFromOrder) => {
    setTransferFromOrder(order);
    setTransferAmount(Math.abs(order.balance).toFixed(2));
    setShowTransferDialog(true);
  };

  const handleTransferBalance = async () => {
    if (transferSubmitting) return;
    if (!transferFromOrder || !transferToOrderNo || !transferAmount) {
      setTransferError(tx('请填写完整信息', 'Please complete all required fields.'));
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError(tx('请输入有效金额', 'Please enter a valid amount.'));
      return;
    }

    setTransferSubmitting(true);
    setTransferError('');

    try {
      const result = await apiCall('invoice', {
        method: 'PUT',
        body: JSON.stringify({
          action: 'transferBalance',
          fromOrderId: transferFromOrder.id,
          toOrderNo: transferToOrderNo.trim(),
          transferAmount: amount,
        }),
      });

      if (result.success) {
        alert(result.message);
        handleTransferDialogOpenChange(false);
        await loadInvoices();
      } else {
        setTransferError(getErrorMessage(result, tx('转移失败', 'Transfer failed')));
      }
    } catch (err) {
      setTransferError(getErrorMessage(err, tx('网络错误，请重试', 'Network error, please retry.')));
      console.error(err);
    } finally {
      setTransferSubmitting(false);
    }
  };

  const openInvoiceDateEditor = (invoiceId: string, currentShipDate?: string | null, currentReleaseDate?: string | null) => {
    setEditingInvoiceDateId(invoiceId);
    setEditingInvoiceShipDate(toDateInputValue(currentShipDate));
    setEditingInvoiceReleaseDate(toDateInputValue(currentReleaseDate));
  };

  const clearInvoiceDateInputs = () => {
    setEditingInvoiceShipDate('');
    setEditingInvoiceReleaseDate('');
  };

  const cancelInvoiceDateEditor = () => {
    setEditingInvoiceDateId(null);
    clearInvoiceDateInputs();
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
        alert(getErrorMessage(result, tx('保存失败', 'Save failed')));
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
        const defaultSelections: Record<string, RematchSelection> = {};
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
        alert(getErrorMessage(result, tx('刷新失败', 'Rematch failed')));
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
        alert(getErrorMessage(result, tx('应用失败', 'Apply rematch failed')));
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

  return {
    showTransferDialog,
    transferFromOrder,
    transferToOrderNo,
    setTransferToOrderNo,
    transferAmount,
    setTransferAmount,
    transferError,
    transferSubmitting,
    handleTransferDialogOpenChange,
    openTransferDialog,
    handleTransferBalance,
    showRematchDialog,
    setShowRematchDialog,
    rematchLoading,
    applyingRematch,
    rematchGroups,
    rematchSelections,
    updateRematchSelection,
    openRematchDialog,
    handleRematchApply,
    orderHistoryOpen,
    orderHistoryTitle,
    orderHistoryRows,
    setOrderHistoryOpen,
    openOrderHistory,
    editingInvoiceDateId,
    editingInvoiceShipDate,
    setEditingInvoiceShipDate,
    editingInvoiceReleaseDate,
    setEditingInvoiceReleaseDate,
    invoiceDateSaving,
    branchAdminOptions,
    branchAdminLoading,
    assigningInvoiceId,
    invoiceBranchAdminSelections,
    loadBranchAdminOptions,
    selectInvoiceBranchAdmin,
    assignInvoiceBranchAdmin,
    openInvoiceDateEditor,
    clearInvoiceDateInputs,
    cancelInvoiceDateEditor,
    saveInvoiceDates,
  };
}
