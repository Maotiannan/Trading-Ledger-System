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
import type { DetailEditablePatch, DetailEditRequestRow } from '@/lib/detail-edit-types';
import { Check, Loader2, Plus, Upload, X } from 'lucide-react';

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
  const [editRequests, setEditRequests] = useState<DetailEditRequestRow[]>([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
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

  const loadDetails = useCallback(async () => {
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
    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      setDetails(cachedResult.data);
    }
    const result = await apiCall(endpoint);
    if (result.success) {
      setDetails(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
  }, [setDetails, search, statusFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const loadDetailEditRequests = useCallback(async () => {
    if (user?.role !== 'ADMIN' && user?.role !== 'SALES') {
      setEditRequests([]);
      return;
    }

    setEditRequestsLoading(true);
    const result = await apiCall('detail', {
      method: 'POST',
      body: JSON.stringify({ action: 'list-edit-requests' }),
    });

    if (result.success && Array.isArray(result.data)) {
      setEditRequests(result.data as DetailEditRequestRow[]);
    } else {
      setEditRequests([]);
      setError(result.error || tx('加载付款明细修改申请失败', 'Failed to load payment detail edit requests.'));
    }
    setEditRequestsLoading(false);
  }, [user?.role, setError, tx]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDetailEditRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDetailEditRequests]);

  const {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteDetail,
    handleDirectCreate,
    handleSubmitDetailEdit,
    handleReviewDetailEdit,
  } = useDetailActions({
    tx,
    loadDetails,
    loadDetailEditRequests,
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
  const canApproveDetailEdits = user?.role === 'ADMIN';

  const getEditRequestStatusBadge = (status: DetailEditRequestRow['status']) => {
    const variants: Record<DetailEditRequestRow['status'], 'outline' | 'default' | 'destructive'> = {
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

  const openEditDialog = (detail: Detail) => {
    setEditingDetailId(detail.id);
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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('付款明细管理', 'Payment Detail Management')}</h2>
        <div className="flex gap-2">
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
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
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

      {canEditDetails && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{tx('付款明细修改申请', 'Payment Detail Edit Requests')}</h3>
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
                    <th className="px-4 py-3">{tx('付款明细', 'Payment Detail')}</th>
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
                      <td className="px-4 py-3">{request.afterSnapshot.date || request.beforeSnapshot.date || '-'}</td>
                      <td className="px-4 py-3">{request.requestedByName || '-'}</td>
                      <td className="px-4 py-3 text-xs leading-5 text-muted-foreground">
                        <div>{`Date: ${request.afterSnapshot.date ?? '-'}`}</div>
                        {request.afterSnapshot.items.map((item, index) => (
                          <div key={`${request.id}-${index}`}>{`${index + 1}. ${item.mark ?? '-'} | ${item.orderNo ?? '-'} | $${item.amount.toFixed(2)} | ${item.receiptId ?? '-'}`}</div>
                        ))}
                      </td>
                      <td className="px-4 py-3">{getEditRequestStatusBadge(request.status)}</td>
                      <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {request.status === 'PENDING' && canApproveDetailEdits ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="default" onClick={() => void handleReviewDetailEdit({ requestId: request.id, decision: 'approve' })} disabled={submitting}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void handleReviewDetailEdit({ requestId: request.id, decision: 'reject' })} disabled={submitting}>
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
                        {tx('暂无付款明细修改申请', 'No payment detail edit requests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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
