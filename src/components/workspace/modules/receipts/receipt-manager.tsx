'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore, type Receipt } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  apiCall,
  getDisplayImageUrl,
  peekPrefetchedApiResult,
  rememberPrefetchedApiResult,
  useLatestRequestGuard,
  useUiText,
} from '@/components/workspace/shared';
import {
  ReceiptDirectCreateDialog,
  ReceiptDirectImageConfirmDialog,
  ReceiptEditDialog,
  ReceiptGeneratorLaunchDialog,
  ReceiptImagePreviewDialog,
  ReceiptList,
  ReceiptUploadDialog,
} from './components';
import { useReceiptCustomerLookup, useReceiptForms, useReceiptActions, useReceiptGenerator } from './hooks';
import type { ReceiptEditablePatch } from '@/lib/receipt-edit-types';
import { Plus, Upload, PenSquare } from 'lucide-react';

const receiptStatusOptions = ['SIGNING_PENDING', 'SR_Received', 'Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED'] as const;
const defaultReceiptStatuses = receiptStatusOptions.filter((status) => status !== 'RECEIVED');
const receiptPageSizeOptions = [30, 50, 100, 200] as const;

export function ReceiptManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(defaultReceiptStatuses);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ReceiptEditablePatch>({
    receiptNo: null,
    date: null,
    invNo: null,
    customerMark: null,
    payer: null,
    tel: null,
  });
  
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(30);
  const totalPages = Math.max(1, Math.ceil(receipts.length / pageSize));
  const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const receiptRequestGuard = useLatestRequestGuard();

  const { loadCustomerCandidates } = useReceiptCustomerLookup();
  const {
    showUpload,
    showDirectCreate,
    ocrResult,
    setOcrResult,
    ocrCustomerMark,
    setOcrCustomerMark,
    ocrCustomerName,
    setOcrCustomerName,
    ocrCustomerId,
    setOcrCustomerId,
    ocrCustomerCandidates,
    setOcrCustomerCandidates,
    imagePreview,
    setImagePreview,
    selectedFile,
    setSelectedFile,
    savedImagePath,
    setSavedImagePath,
    ocrUploadStatus,
    setOcrUploadStatus,
    ocrUploadMessage,
    setOcrUploadMessage,
    ocrUploadProgress,
    setOcrUploadProgress,
    error,
    setError,
    directForm,
    setDirectForm,
    directCustomerCandidates,
    directSavedImagePath,
    setDirectSavedImagePath,
    directUploadedImageName,
    setDirectUploadedImageName,
    pendingDirectImageSelection,
    setPendingDirectImageSelection,
    directUploadStatus,
    setDirectUploadStatus,
    directUploadMessage,
    setDirectUploadMessage,
    directUploadProgress,
    setDirectUploadProgress,
    directInvConflict,
    directInvConflictCount,
    ocrInvConflict,
    ocrInvConflictCount,
    viewingImage,
    setViewingImage,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    handleOcrCustomerMarkChange,
    handleOcrCustomerSelect,
    handleDirectCustomerMarkChange,
    handleDirectCustomerSelect,
    resetDirectForm,
  } = useReceiptForms(loadCustomerCandidates);
  const loadReceipts = useCallback(async () => {
    const requestToken = receiptRequestGuard.nextToken();
    setLoading(true);
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    for (const status of statusFilter) params.append('status', status);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minUsd) params.set('minUsd', minUsd);
    if (maxUsd) params.set('maxUsd', maxUsd);
    const query = params.toString();
    const endpoint = `receipt${query ? `?${query}` : ''}`;
    const canUsePrefetch =
      !trimmedSearch &&
      statusFilter.length === defaultReceiptStatuses.length &&
      statusFilter.every((status) => defaultReceiptStatuses.includes(status as typeof defaultReceiptStatuses[number])) &&
      !dateFrom &&
      !dateTo &&
      !minUsd &&
      !maxUsd;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: typeof receipts }>(endpoint) : null;
    if (cachedResult?.success && Array.isArray(cachedResult.data) && receiptRequestGuard.isLatest(requestToken)) {
      setReceipts(cachedResult.data);
      setLoading(false);
    }
    const result = await apiCall(endpoint);
    if (!receiptRequestGuard.isLatest(requestToken)) return;
    if (result.success) {
      setReceipts(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
    setLoading(false);
  }, [dateFrom, dateTo, maxUsd, minUsd, receiptRequestGuard, receipts, search, setLoading, setReceipts, statusFilter]);

  const {
    uploading,
    directUploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDirectImageSelect,
    handleConfirmDirectImageUpload,
    handleMarkReceived,
    handleDirectCreate,
    handleDeleteReceipt,
    handleSubmitReceiptEdit,
  } = useReceiptActions({
    tx,
    loadReceipts,
    loadReceiptEditRequests: useCallback(async () => {}, []),
    selectedFile,
    ocrResult,
    ocrCustomerMark,
    ocrCustomerName,
    ocrCustomerId,
    savedImagePath,
    directSavedImagePath,
    directForm,
    pendingDirectImageSelection,
    setOcrResult,
    setOcrCustomerMark,
    setOcrCustomerName,
    setOcrCustomerId,
    setOcrCustomerCandidates,
    setImagePreview,
    setSelectedFile,
    setSavedImagePath,
    setDirectSavedImagePath,
    setDirectUploadedImageName,
    setPendingDirectImageSelection,
    setOcrUploadStatus,
    setOcrUploadMessage,
    setOcrUploadProgress,
    setDirectUploadStatus,
    setDirectUploadMessage,
    setDirectUploadProgress,
    setError,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  });

  const canUseReceiptGenerator = user?.role !== 'USER';
  const {
    showGeneratorLaunch,
    setShowGeneratorLaunch,
    generatorOrderNo,
    setGeneratorOrderNo,
    generatorUsdAmount,
    setGeneratorUsdAmount,
    generatorPaymentMode,
    setGeneratorPaymentMode,
    generatorContext,
    generatorContextLoading,
    generatorCreating,
    generatorError,
    resetGeneratorState,
    createGeneratorSession,
    resumeGeneratorSession,
  } = useReceiptGenerator({
    tx,
    loadReceipts,
    setError,
  });

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  const resetToFirstPage = () => setCurrentPage(1);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((prev) => (
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status]
    ));
    resetToFirstPage();
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setCurrentPage(1);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'SIGNING_PENDING': 'destructive',
      'SR_Received': 'secondary',
      'Waiting_SWIFT': 'outline',
      'Bank_Transfer': 'default',
      'RECEIVED': 'default'
    };
    return <Badge variant={colors[status] || 'default'}>{status}</Badge>;
  };

  const isAdmin = user?.role === 'ADMIN';
  const canEditReceipts = user?.role === 'ADMIN' || user?.role === 'SALES';
  const toEditableDateValue = (value: string | null | undefined) => {
    if (!value) return null;
    const trimmed = value.trim();
    const matched = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    return matched ? matched[1] : trimmed;
  };

  const openEditDialog = (receipt: Receipt) => {
    setEditingReceiptId(receipt.id);
    setEditForm({
      receiptNo: receipt.receiptNo ?? null,
      date: toEditableDateValue(receipt.date),
      invNo: receipt.invNo ?? null,
      customerMark: receipt.customerMark ?? null,
      payer: receipt.payer ?? null,
      tel: receipt.tel ?? null,
    });
    setShowEditDialog(true);
    setError(null);
  };

  const closeEditDialog = () => {
    if (submitting) return;
    setShowEditDialog(false);
    setEditingReceiptId(null);
  };

  const submitReceiptEdit = async () => {
    if (!editingReceiptId) return;
    const outcome = await handleSubmitReceiptEdit({
      receiptId: editingReceiptId,
      data: editForm,
      isAdmin,
    });
    if (outcome.success) {
      closeEditDialog();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">{tx('收据管理', 'Receipt Management')}</h2>
        <div
          data-testid="receipt-manager-primary-actions"
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end"
        >
          <Button onClick={() => handleShowUploadChange(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {tx('上传收据', 'Upload Receipt')}
          </Button>
          <Button variant="outline" onClick={() => handleShowDirectCreateChange(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          {canUseReceiptGenerator && (
            <Button variant="outline" onClick={() => setShowGeneratorLaunch(true)}>
              <PenSquare className="h-4 w-4 mr-2" />
              {tx('生成签名收据', 'Generate Signed Receipt')}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Input placeholder={tx('搜索收据号/单号/付款人', 'Search receipt/order/payer')} value={search} onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }} />
          <div className="rounded-md border px-3 py-2 md:col-span-2 lg:col-span-2">
            <div className="mb-2 text-sm font-medium">{tx('状态筛选', 'Status Filter')}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {receiptStatusOptions.map((status) => (
                <Label key={status} className="flex items-center gap-2 text-sm font-normal">
                  <input
                    type="checkbox"
                    aria-label={status}
                    checked={statusFilter.includes(status)}
                    onChange={() => toggleStatusFilter(status)}
                  />
                  <span>{status}</span>
                </Label>
              ))}
            </div>
          </div>
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
          <Input type="number" placeholder={tx('最小金额', 'Min amount')} value={minUsd} onChange={(e) => { setMinUsd(e.target.value); resetToFirstPage(); }} />
          <Input type="number" placeholder={tx('最大金额', 'Max amount')} value={maxUsd} onChange={(e) => { setMaxUsd(e.target.value); resetToFirstPage(); }} />
          <div className="flex items-center gap-2">
            <Label htmlFor="receipt-page-size">{tx('每页条数', 'Rows per page')}</Label>
            <select
              id="receipt-page-size"
              aria-label={tx('每页条数', 'Rows per page')}
              className="border rounded-md px-3 py-2 text-sm"
              value={String(pageSize)}
              onChange={(event) => handlePageSizeChange(Number(event.target.value))}
            >
              {receiptPageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter(defaultReceiptStatuses);
                setDateFrom('');
                setDateTo('');
                setMinUsd('');
                setMaxUsd('');
                resetToFirstPage();
              }}
            >
              {tx('重置筛选', 'Reset Filters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReceiptList
        receipts={receipts}
        paginatedReceipts={paginatedReceipts}
        currentPage={currentPage}
        totalPages={totalPages}
        isAdmin={isAdmin}
        canEdit={canEditReceipts}
        canResumeSigning={canUseReceiptGenerator}
        tx={tx}
        getStatusBadge={getStatusBadge}
        onViewImage={(receipt) => {
          if (!receipt.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(receipt.imageUrl),
            name: receipt.imageName || tx('收据图片', 'Receipt image'),
          });
        }}
        onEditReceipt={openEditDialog}
        onMarkReceived={handleMarkReceived}
        onDeleteReceipt={handleDeleteReceipt}
        onResumeSigning={resumeGeneratorSession}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
      />

      <ReceiptGeneratorLaunchDialog
        open={showGeneratorLaunch}
        orderNo={generatorOrderNo}
        usdAmount={generatorUsdAmount}
        paymentMode={generatorPaymentMode}
        loadingContext={generatorContextLoading}
        creatingSession={generatorCreating}
        error={generatorError}
        context={generatorContext}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) resetGeneratorState();
          else setShowGeneratorLaunch(true);
        }}
        onOrderNoChange={setGeneratorOrderNo}
        onUsdAmountChange={setGeneratorUsdAmount}
        onPaymentModeChange={setGeneratorPaymentMode}
        onSubmit={createGeneratorSession}
      />

      <ReceiptUploadDialog
        open={showUpload}
        uploading={uploading}
        submitting={submitting}
        error={error}
        imagePreview={imagePreview}
        ocrResult={ocrResult}
        ocrCustomerMark={ocrCustomerMark}
        ocrCustomerId={ocrCustomerId}
        ocrCustomerCandidates={ocrCustomerCandidates}
        ocrInvConflict={ocrInvConflict}
        ocrInvConflictCount={ocrInvConflictCount}
        ocrUploadStatus={ocrUploadStatus}
        ocrUploadMessage={ocrUploadMessage}
        ocrUploadProgress={ocrUploadProgress}
        tx={tx}
        onOpenChange={handleShowUploadChange}
        onFileSelect={handleFileSelect}
        onOcrResultChange={setOcrResult}
        onOcrCustomerMarkChange={handleOcrCustomerMarkChange}
        onOcrCustomerSelect={handleOcrCustomerSelect}
        onConfirm={handleConfirm}
      />

      <ReceiptDirectCreateDialog
        open={showDirectCreate}
        locale={locale}
        form={directForm}
        customerCandidates={directCustomerCandidates}
        tx={tx}
        uploadedImageName={directUploadedImageName}
        directUploading={directUploading}
        directUploadStatus={directUploadStatus}
        directUploadMessage={directUploadMessage}
        directUploadProgress={directUploadProgress}
        invConflict={directInvConflict}
        invConflictCount={directInvConflictCount}
        onOpenChange={handleShowDirectCreateChange}
        onFormChange={setDirectForm}
        onCustomerMarkChange={handleDirectCustomerMarkChange}
        onCustomerSelect={handleDirectCustomerSelect}
        onImageSelect={handleDirectImageSelect}
        onSubmit={handleDirectCreate}
      />

      <ReceiptDirectImageConfirmDialog
        selection={pendingDirectImageSelection}
        tx={tx}
        uploading={directUploading}
        uploadMessage={directUploadMessage}
        uploadProgress={directUploadProgress}
        onOpenChange={(open) => {
          if (!open && !directUploading) {
            setPendingDirectImageSelection(null);
          }
        }}
        onConfirm={handleConfirmDirectImageUpload}
      />

      <ReceiptImagePreviewDialog
        image={viewingImage}
        onOpenChange={(open) => {
          if (!open) setViewingImage(null);
        }}
      />

      <ReceiptEditDialog
        open={showEditDialog}
        locale={locale}
        form={editForm}
        submitting={submitting}
        isAdmin={isAdmin}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
          else setShowEditDialog(true);
        }}
        onFormChange={setEditForm}
        onSubmit={() => {
          void submitReceiptEdit();
        }}
      />
    </div>
  );
}
