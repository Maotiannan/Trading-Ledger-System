'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import {
  apiCall,
  useUiText,
} from '@/components/workspace/shared';
import { ImportResultDialog } from '@/components/workspace/components/import-result-dialog';
import {
  CreateInvoiceDialog,
  EditOrderDialog,
  InvoiceList,
  InvoiceSearchCard,
  InvoiceToolbar,
  OrderHistoryDialog,
  RematchDialog,
  TransferBalanceDialog,
} from './components';
import { useInvoiceActions, useInvoiceCustomerLookup, useInvoiceImport, useInvoiceOrderForms, useInvoiceTools } from './hooks';

export function InvoiceManager() {
  const tx = useUiText();
  const { invoices, setInvoices, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  
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
  const {
    submitting,
    downloadInvoiceImportTemplate,
    openInvoiceImportPicker,
    handleCreateInvoice,
    handleUpdateOrder,
    handleDeleteOrder,
    handleAddOrder,
  } = useInvoiceActions({
    tx,
    invoiceImportInputRef,
    loadInvoices,
    invNo,
    shipDate,
    releaseDate,
    orders,
    setFormError,
    handleCreateDialogOpenChange,
    resetCreateInvoiceDialog,
    editingOrder,
    setOrderFormError,
    handleOrderDialogOpenChange,
    addingOrderToInvoice,
    setAddError,
    newOrderNo,
    newOrderAmount,
    newOrderCustomerMark,
    newOrderCustomerName,
    newOrderCustomerId,
    resetAddOrderForm,
  });

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const toggleInvoice = (invoiceId: string) => {
    const newExpanded = new Set(expandedInvoices);
    if (newExpanded.has(invoiceId)) {
      newExpanded.delete(invoiceId);
    } else {
      newExpanded.add(invoiceId);
    }
    setExpandedInvoices(newExpanded);
  };

  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  return (
    <div className="space-y-6">
      <InvoiceToolbar
        isManager={isManager}
        invoiceImporting={invoiceImporting}
        rematchLoading={rematchLoading}
        tx={tx}
        inputRef={invoiceImportInputRef}
        onFileChange={(file) => void handleInvoiceExcelImport(file)}
        onDownloadTemplate={downloadInvoiceImportTemplate}
        onOpenImport={openInvoiceImportPicker}
        onOpenRematch={openRematchDialog}
        onOpenCreate={() => handleCreateDialogOpenChange(true)}
      />

      <InvoiceSearchCard
        search={search}
        tx={tx}
        onSearchChange={setSearch}
        onReset={() => setSearch('')}
      />

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
        submitting={transferSubmitting}
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
