'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  apiCall,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  summarizeRowsForAlert,
  useUiText,
} from '@/components/workspace/shared';
import { ImportResultDialog } from '@/components/workspace/components/import-result-dialog';
import {
  CreateInvoiceDialog,
  EditOrderDialog,
  InvoiceList,
  OrderHistoryDialog,
  RematchDialog,
  TransferBalanceDialog,
} from './components';
import { useInvoiceCustomerLookup, useInvoiceImport, useInvoiceOrderForms, useInvoiceTools } from './hooks';
import { Loader2, Plus, Upload, RefreshCw } from 'lucide-react';

export function InvoiceManager() {
  const tx = useUiText();
  const { invoices, setInvoices, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // 展开状态
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const invoiceImportInputRef = useRef<HTMLInputElement | null>(null);

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

  const { loadCustomerCandidates } = useInvoiceCustomerLookup();
  const {
    showDialog,
    invNo,
    setInvNo,
    shipDate,
    setShipDate,
    releaseDate,
    setReleaseDate,
    orders,
    formError,
    setFormError,
    resetCreateInvoiceDialog,
    handleCreateDialogOpenChange,
    addOrderRow,
    updateOrder,
    removeOrder,
    selectCreateInvoiceCustomer,
    editingOrder,
    setEditingOrder,
    showOrderDialog,
    orderFormError,
    setOrderFormError,
    editingOrderCandidates,
    handleOrderDialogOpenChange,
    openEditOrder,
    handleEditingOrderMarkChange,
    selectEditingOrderCustomer,
    addingOrderToInvoice,
    addError,
    setAddError,
    newOrderNo,
    newOrderAmount,
    setNewOrderAmount,
    newOrderCustomerMark,
    newOrderCustomerName,
    newOrderCustomerId,
    newOrderCustomerCandidates,
    startAddOrder,
    handleNewOrderNoChange,
    handleNewOrderCustomerMarkChange,
    selectNewOrderCustomer,
    resetAddOrderForm,
  } = useInvoiceOrderForms(loadCustomerCandidates);
  const {
    showTransferDialog,
    transferFromOrder,
    transferToOrderNo,
    setTransferToOrderNo,
    transferAmount,
    setTransferAmount,
    transferError,
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
    openInvoiceDateEditor,
    clearInvoiceDateInputs,
    cancelInvoiceDateEditor,
    saveInvoiceDates,
  } = useInvoiceTools(tx, loadInvoices);
  const {
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
  } = useInvoiceImport(tx, loadInvoices, invoiceImportInputRef);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

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
        handleCreateDialogOpenChange(false);
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
        resetAddOrderForm();
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
                disabled={rematchLoading}
              >
                {rematchLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {tx('刷新匹配', 'Rematch')}
              </Button>
              <Button onClick={() => handleCreateDialogOpenChange(true)}>
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
        onClearInvoiceDates={clearInvoiceDateInputs}
        onSaveInvoiceDates={saveInvoiceDates}
        onCancelInvoiceDateEditor={cancelInvoiceDateEditor}
        onStartAddOrder={startAddOrder}
        onNewOrderNoChange={handleNewOrderNoChange}
        onNewOrderAmountChange={setNewOrderAmount}
        onNewOrderCustomerMarkChange={handleNewOrderCustomerMarkChange}
        onNewOrderCustomerSelect={selectNewOrderCustomer}
        onSubmitAddOrder={handleAddOrder}
        onCancelAddOrder={resetAddOrderForm}
        onOpenOrderHistory={openOrderHistory}
        onOpenTransfer={openTransferDialog}
        onOpenEditOrder={openEditOrder}
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
        onSubmit={() => void handleTransferBalance(submitting, setSubmitting)}
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
