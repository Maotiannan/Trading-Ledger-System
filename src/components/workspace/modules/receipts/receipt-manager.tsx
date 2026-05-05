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
import type { ReceiptEditablePatch, ReceiptEditRequestRow } from '@/lib/receipt-edit-types';
import {
  Loader2, Plus, Upload, Check, PenSquare, X
} from 'lucide-react';

export function ReceiptManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  const [editRequests, setEditRequests] = useState<ReceiptEditRequestRow[]>([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
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
  const pageSize = 30;
  const totalPages = Math.ceil(receipts.length / pageSize);
  const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
    setLoading(true);
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minUsd) params.set('minUsd', minUsd);
    if (maxUsd) params.set('maxUsd', maxUsd);
    const query = params.toString();
    const endpoint = `receipt${query ? `?${query}` : ''}`;
    const canUsePrefetch = !trimmedSearch && !statusFilter && !dateFrom && !dateTo && !minUsd && !maxUsd;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: typeof receipts }>(endpoint) : null;
    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      setReceipts(cachedResult.data);
      setLoading(false);
    }
    const result = await apiCall(endpoint);
    if (result.success) {
      setReceipts(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
    setLoading(false);
  }, [setReceipts, setLoading, search, statusFilter, dateFrom, dateTo, minUsd, maxUsd]);

  const loadReceiptEditRequests = useCallback(async () => {
    if (user?.role !== 'ADMIN' && user?.role !== 'SALES') {
      setEditRequests([]);
      return;
    }

    setEditRequestsLoading(true);
    const result = await apiCall('receipt', {
      method: 'POST',
      body: JSON.stringify({ action: 'list-edit-requests' }),
    });

    if (result.success && Array.isArray(result.data)) {
      setEditRequests(result.data as ReceiptEditRequestRow[]);
    } else {
      setEditRequests([]);
      setError(result.error || tx('加载收据修改申请失败', 'Failed to load receipt edit requests.'));
    }
    setEditRequestsLoading(false);
  }, [user?.role, setError, tx]);

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
    handleReviewReceiptEdit,
  } = useReceiptActions({
    tx,
    loadReceipts,
    loadReceiptEditRequests,
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReceiptEditRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReceiptEditRequests]);

  const resetToFirstPage = () => setCurrentPage(1);

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
  const canApproveReceiptEdits = user?.role === 'ADMIN';

  const getEditRequestStatusBadge = (status: ReceiptEditRequestRow['status']) => {
    const variants: Record<ReceiptEditRequestRow['status'], 'outline' | 'default' | 'destructive'> = {
      PENDING: 'outline',
      APPROVED: 'default',
      REJECTED: 'destructive',
    };
    return <Badge variant={variants[status]}>{status}</Badge>;
  };

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
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder={tx('搜索收据号/单号/付款人', 'Search receipt/order/payer')} value={search} onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }} />
          <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetToFirstPage(); }}>
            <option value="">{tx('全部状态', 'All statuses')}</option>
            <option value="SIGNING_PENDING">SIGNING_PENDING</option>
            <option value="SR_Received">SR_Received</option>
            <option value="Waiting_SWIFT">Waiting_SWIFT</option>
            <option value="Bank_Transfer">Bank_Transfer</option>
            <option value="RECEIVED">RECEIVED</option>
          </select>
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
          <Input type="number" placeholder={tx('最小金额', 'Min amount')} value={minUsd} onChange={(e) => { setMinUsd(e.target.value); resetToFirstPage(); }} />
          <Input type="number" placeholder={tx('最大金额', 'Max amount')} value={maxUsd} onChange={(e) => { setMaxUsd(e.target.value); resetToFirstPage(); }} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
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

      {canEditReceipts && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{tx('收据修改申请', 'Receipt Edit Requests')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {tx('销售提交后等待管理员审批；管理员可直接审批可见范围内的申请。', 'Sales submissions wait for admin approval; admins can review visible requests directly.')}
                  </p>
                </div>
                {editRequestsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-4 py-3">{tx('收据号', 'Receipt No.')}</th>
                    <th className="px-4 py-3">{tx('申请人', 'Requester')}</th>
                    <th className="px-4 py-3">{tx('修改后', 'Requested Values')}</th>
                    <th className="px-4 py-3">{tx('状态', 'Status')}</th>
                    <th className="px-4 py-3">{tx('申请时间', 'Requested At')}</th>
                    <th className="px-4 py-3">{tx('操作', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {editRequests.map((request) => (
                    <tr key={request.id} className="border-b align-top">
                      <td className="px-4 py-3">{request.afterSnapshot.receiptNo || request.beforeSnapshot.receiptNo || '-'}</td>
                      <td className="px-4 py-3">{request.requestedByName || '-'}</td>
                      <td className="px-4 py-3 text-xs leading-5 text-muted-foreground">
                        <div>{`Receipt No: ${request.afterSnapshot.receiptNo ?? '-'}`}</div>
                        <div>{`Payment Date: ${request.afterSnapshot.date ?? '-'}`}</div>
                        <div>{`INV No: ${request.afterSnapshot.invNo ?? '-'}`}</div>
                        <div>{`MARK: ${request.afterSnapshot.customerMark ?? '-'}`}</div>
                        <div>{`Payer: ${request.afterSnapshot.payer ?? '-'}`}</div>
                        <div>{`Phone: ${request.afterSnapshot.tel ?? '-'}`}</div>
                      </td>
                      <td className="px-4 py-3">{getEditRequestStatusBadge(request.status)}</td>
                      <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {request.status === 'PENDING' && canApproveReceiptEdits ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="default" onClick={() => void handleReviewReceiptEdit({ requestId: request.id, decision: 'approve' })} disabled={submitting}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void handleReviewReceiptEdit({ requestId: request.id, decision: 'reject' })} disabled={submitting}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {request.status === 'PENDING'
                              ? tx('等待审批', 'Pending review')
                              : request.approvedByName || '-'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {editRequests.length === 0 && !editRequestsLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        {tx('暂无收据修改申请', 'No receipt edit requests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
