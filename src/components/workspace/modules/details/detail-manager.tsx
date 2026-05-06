'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore, type Detail } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  apiCall,
  getDisplayImageUrl,
  peekPrefetchedApiResult,
  rememberPrefetchedApiResult,
  useLatestRequestGuard,
  useUiText,
} from '@/components/workspace/shared';
import {
  DetailDirectCreateDialog,
  DetailEditDialog,
  DetailImagePreviewDialog,
  DetailList,
  DetailUploadDialog,
} from './components';
import { useDetailActions, useDetailForms } from './hooks';
import type { DetailEditablePatch } from '@/lib/detail-edit-types';
import { Plus, Upload } from 'lucide-react';

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails, user } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [editLinkedReceiptLabels, setEditLinkedReceiptLabels] = useState<string[]>([]);
  const [editForm, setEditForm] = useState<DetailEditablePatch>({
    date: null,
    items: [],
  });

  const {
    showUpload,
    showDirectCreate,
    ocrResult,
    setOcrResult,
    imagePreview,
    setImagePreview,
    selectedFile,
    setSelectedFile,
    error,
    setError,
    savedImagePath,
    setSavedImagePath,
    ocrUploadStatus,
    setOcrUploadStatus,
    ocrUploadMessage,
    setOcrUploadMessage,
    ocrUploadProgress,
    setOcrUploadProgress,
    directDate,
    setDirectDate,
    directItems,
    setDirectItems,
    expandedDetails,
    viewingImage,
    setViewingImage,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    toggleDetail,
    resetDirectForm,
  } = useDetailForms();
  const detailRequestGuard = useLatestRequestGuard();

  const loadDetails = useCallback(async () => {
    const requestToken = detailRequestGuard.nextToken();
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    const query = params.toString();
    const endpoint = `detail${query ? `?${query}` : ''}`;
    const canUsePrefetch = !trimmedSearch && !statusFilter && !dateFrom && !dateTo && !minAmount && !maxAmount;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: typeof details }>(endpoint) : null;
    if (cachedResult?.success && Array.isArray(cachedResult.data) && detailRequestGuard.isLatest(requestToken)) {
      setDetails(cachedResult.data);
    }
    const result = await apiCall(endpoint);
    if (!detailRequestGuard.isLatest(requestToken)) return;
    if (result.success) {
      setDetails(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
  }, [dateFrom, dateTo, detailRequestGuard, details, maxAmount, minAmount, search, setDetails, statusFilter]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteDetail,
    handleDirectCreate,
    handleSubmitDetailEdit,
  } = useDetailActions({
    tx,
    loadDetails,
    loadDetailEditRequests: useCallback(async () => {}, []),
    selectedFile,
    ocrResult,
    savedImagePath,
    directDate,
    directItems,
    setOcrResult,
    setImagePreview,
    setSelectedFile,
    setError,
    setSavedImagePath,
    setOcrUploadStatus,
    setOcrUploadMessage,
    setOcrUploadProgress,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  });

  const isAdmin = user?.role === 'ADMIN';
  const canEditDetails = user?.role === 'ADMIN' || user?.role === 'SALES';
  const toEditableDateValue = (value: string | null | undefined) => {
    if (!value) return null;
    const trimmed = value.trim();
    const matched = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    return matched ? matched[1] : trimmed;
  };

  const openEditDialog = (detail: Detail) => {
    setEditingDetailId(detail.id);
    setEditLinkedReceiptLabels(detail.items.map((item) => {
      if (!item.receipt) {
        return tx('未匹配', 'Unmatched');
      }
      const receiptNo = item.receipt.receiptNo?.trim();
      if (receiptNo) return receiptNo;
      const orderNo = item.receipt.orderNo?.trim();
      if (orderNo) return orderNo;
      const payer = item.receipt.payer?.trim();
      if (payer) return payer;
      return tx('已关联收据', 'Linked receipt');
    }));
    setEditForm({
      date: toEditableDateValue(detail.date),
      items: detail.items.map((item) => ({
        mark: item.mark ?? null,
        orderNo: item.orderNo ?? null,
        amount: Number(item.amount),
        receiptId: item.receiptId ?? null,
      })),
    });
    setShowEditDialog(true);
    setError(null);
  };

  const closeEditDialog = () => {
    if (submitting) return;
    setShowEditDialog(false);
    setEditingDetailId(null);
    setEditLinkedReceiptLabels([]);
  };

  const submitDetailEdit = async () => {
    if (!editingDetailId) return;
    const outcome = await handleSubmitDetailEdit({
      detailId: editingDetailId,
      data: editForm,
      isAdmin,
    });
    if (outcome.success) {
      closeEditDialog();
    }
  };

  const handleExportDetailPic = (detailId: string) => {
    const anchor = document.createElement('a');
    anchor.href = `/api/detail?action=export-pic&detailId=${encodeURIComponent(detailId)}`;
    anchor.rel = 'noopener';
    anchor.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">{tx('付款明细管理', 'Payment Detail Management')}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="outline" onClick={() => handleShowDirectCreateChange(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => handleShowUploadChange(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {tx('上传付款明细', 'Upload Payment Detail')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Input placeholder={tx('搜索唛头/单号', 'Search mark/order no.')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx('全部状态', 'All statuses')}</option>
            <option value="Waiting_SWIFT">Waiting_SWIFT</option>
            <option value="Bank_Transfer">Bank_Transfer</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="ERROR">ERROR</option>
          </select>
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder={tx('最小总金额', 'Min total amount')} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <Input type="number" placeholder={tx('最大总金额', 'Max total amount')} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setMinAmount('');
                setMaxAmount('');
              }}
            >
              {tx('重置筛选', 'Reset Filters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DetailList
        details={details}
        expandedDetails={expandedDetails}
        canEdit={canEditDetails}
        tx={tx}
        onToggleDetail={toggleDetail}
        onViewImage={(detail) => {
          if (!detail.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(detail.imageUrl),
            name: detail.imageName || tx('付款明细图片', 'Payment detail image'),
          });
        }}
        onEditDetail={openEditDialog}
        onExportDetailPic={handleExportDetailPic}
        onDeleteDetail={handleDeleteDetail}
      />

      <DetailUploadDialog
        open={showUpload}
        uploading={uploading}
        submitting={submitting}
        error={error}
        imagePreview={imagePreview}
        ocrResult={ocrResult}
        ocrUploadStatus={ocrUploadStatus}
        ocrUploadMessage={ocrUploadMessage}
        ocrUploadProgress={ocrUploadProgress}
        tx={tx}
        onOpenChange={handleShowUploadChange}
        onFileSelect={handleFileSelect}
        onOcrResultChange={setOcrResult}
        onConfirm={handleConfirm}
      />

      <DetailDirectCreateDialog
        open={showDirectCreate}
        locale={locale}
        directDate={directDate}
        directItems={directItems}
        tx={tx}
        onOpenChange={handleShowDirectCreateChange}
        onDirectDateChange={setDirectDate}
        onDirectItemsChange={setDirectItems}
        onSubmit={handleDirectCreate}
      />

      <DetailImagePreviewDialog
        image={viewingImage}
        onOpenChange={(open) => {
          if (!open) {
            setViewingImage(null);
          }
        }}
      />

      <DetailEditDialog
        open={showEditDialog}
        locale={locale}
        form={editForm}
        linkedReceiptLabels={editLinkedReceiptLabels}
        submitting={submitting}
        isAdmin={isAdmin}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
          else setShowEditDialog(true);
        }}
        onFormChange={setEditForm}
        onSubmit={submitDetailEdit}
      />
    </div>
  );
}
