'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore, type Receipt } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResponsiveFilterCard } from '@/components/workspace/modules/shared/responsive-filter-card';
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

type ReceiptFilterState = {
  search: string;
  statuses: string[];
  dateFrom: string;
  dateTo: string;
  minUsd: string;
  maxUsd: string;
};

const defaultAppliedFilters: ReceiptFilterState = {
  search: '',
  statuses: defaultReceiptStatuses,
  dateFrom: '',
  dateTo: '',
  minUsd: '',
  maxUsd: '',
};

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
  const [appliedFilters, setAppliedFilters] = useState<ReceiptFilterState>(defaultAppliedFilters);
  const [filterRequestVersion, setFilterRequestVersion] = useState(0);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ReceiptEditablePatch>({
    receiptNo: null,
    date: null,
    orderNo: null,
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
    const trimmedSearch = appliedFilters.search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    for (const status of appliedFilters.statuses) params.append('status', status);
    if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
    if (appliedFilters.minUsd) params.set('minUsd', appliedFilters.minUsd);
    if (appliedFilters.maxUsd) params.set('maxUsd', appliedFilters.maxUsd);
    const query = params.toString();
    const endpoint = `receipt${query ? `?${query}` : ''}`;
    const canUsePrefetch =
      !trimmedSearch &&
      appliedFilters.statuses.length === defaultReceiptStatuses.length &&
      appliedFilters.statuses.every((status) => defaultReceiptStatuses.includes(status as typeof defaultReceiptStatuses[number])) &&
      !appliedFilters.dateFrom &&
      !appliedFilters.dateTo &&
      !appliedFilters.minUsd &&
      !appliedFilters.maxUsd;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: Receipt[] }>(endpoint) : null;
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
  }, [appliedFilters, receiptRequestGuard, setLoading, setReceipts]);

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
  }, [filterRequestVersion, loadReceipts]);

  const resetToFirstPage = () => setCurrentPage(1);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((prev) => (
      prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status]
    ));
    resetToFirstPage();
  };

  const applyFilters = () => {
    setAppliedFilters({
      search,
      statuses: statusFilter,
      dateFrom,
      dateTo,
      minUsd,
      maxUsd,
    });
    resetToFirstPage();
    setFilterRequestVersion((version) => version + 1);
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter(defaultReceiptStatuses);
    setDateFrom('');
    setDateTo('');
    setMinUsd('');
    setMaxUsd('');
    setAppliedFilters(defaultAppliedFilters);
    resetToFirstPage();
    setFilterRequestVersion((version) => version + 1);
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
  const statusSummary = statusFilter.length === receiptStatusOptions.length
    ? tx('全部状态', 'All statuses')
    : tx(`已选 ${statusFilter.length} 个状态`, `${statusFilter.length} statuses`);
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
      orderNo: receipt.order?.orderNo ?? receipt.orderNo ?? null,
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

      <ResponsiveFilterCard
        testIdPrefix="receipt"
        filterLabel={tx('筛选', 'Filters')}
        renderSearch={() => (
          <Input
            placeholder={tx('搜索收据号/单号/付款人', 'Search receipt/order/payer')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }}
          />
        )}
        renderMobileSearchAction={() => (
          <Button onClick={applyFilters}>{tx('查询', 'Search')}</Button>
        )}
        renderFilters={() => (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-between" aria-label={tx('状态筛选', 'Status Filter')}>
                  <span>{tx('状态筛选', 'Status Filter')}</span>
                  <span className="text-xs text-muted-foreground">{statusSummary}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <div className="mb-3 text-sm font-medium">{tx('状态筛选', 'Status Filter')}</div>
                <div className="grid gap-2">
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
              </PopoverContent>
            </Popover>
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
            <Input type="number" placeholder={tx('最小金额', 'Min amount')} value={minUsd} onChange={(e) => { setMinUsd(e.target.value); resetToFirstPage(); }} />
            <Input type="number" placeholder={tx('最大金额', 'Max amount')} value={maxUsd} onChange={(e) => { setMaxUsd(e.target.value); resetToFirstPage(); }} />
          </>
        )}
        renderActions={() => (
          <div className="flex flex-col gap-2 md:col-span-3 lg:col-span-6 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={resetFilters}
            >
              {tx('重置筛选', 'Reset Filters')}
            </Button>
            <Button onClick={applyFilters}>{tx('查询', 'Search')}</Button>
          </div>
        )}
      />

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
            alt: tx('收据图片', 'Receipt image'),
            orderNo: receipt.order?.orderNo || receipt.orderNo || '-',
            invNo: receipt.order?.invoice?.invNo || receipt.invNo || '-',
            creator: receipt.creator?.name || receipt.creator?.email || '-',
          });
        }}
        onEditReceipt={openEditDialog}
        onMarkReceived={handleMarkReceived}
        onDeleteReceipt={handleDeleteReceipt}
        onResumeSigning={resumeGeneratorSession}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
        pageSize={pageSize}
        pageSizeOptions={receiptPageSizeOptions}
        onPageSizeChange={handlePageSizeChange}
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
        tx={tx}
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
