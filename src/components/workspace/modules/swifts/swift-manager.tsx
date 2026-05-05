'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore, type Swift } from '@/lib/store';
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
import { SwiftDirectCreateDialog, SwiftEditDialog, SwiftImagePreviewDialog, SwiftList, SwiftUploadDialog } from './components';
import { useSwiftActions, useSwiftForms } from './hooks';
import type { SwiftEditablePatch, SwiftEditRequestRow } from '@/lib/swift-edit-types';
import { Check, Loader2, Plus, Upload, X } from 'lucide-react';

export function SwiftManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { swifts, setSwifts, details, user } = useStore();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [hasErrorFilter, setHasErrorFilter] = useState('');
  const [editRequests, setEditRequests] = useState<SwiftEditRequestRow[]>([]);
  const [editRequestsLoading, setEditRequestsLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingSwiftId, setEditingSwiftId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SwiftEditablePatch>({
    date: null,
    amount: 0,
    senderName: null,
    senderAddress: null,
    receiverName: null,
    receiverAccount: null,
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
    savedImagePath,
    setSavedImagePath,
    viewingImage,
    setViewingImage,
    selectedDetailId,
    setSelectedDetailId,
    error,
    setError,
    directForm,
    setDirectForm,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  } = useSwiftForms();

  const loadSwifts = useCallback(async () => {
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    if (hasErrorFilter) params.set('hasError', hasErrorFilter);
    const query = params.toString();
    const endpoint = `swift${query ? `?${query}` : ''}`;
    const canUsePrefetch = !trimmedSearch && !dateFrom && !dateTo && !minAmount && !maxAmount && !hasErrorFilter;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: typeof swifts }>(endpoint) : null;
    if (cachedResult?.success && Array.isArray(cachedResult.data)) {
      setSwifts(cachedResult.data);
    }
    const result = await apiCall(endpoint);
    if (result.success) {
      setSwifts(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
  }, [setSwifts, search, dateFrom, dateTo, minAmount, maxAmount, hasErrorFilter]);

  const loadSwiftEditRequests = useCallback(async () => {
    if (user?.role !== 'ADMIN' && user?.role !== 'SALES') {
      setEditRequests([]);
      return;
    }

    setEditRequestsLoading(true);
    const result = await apiCall('swift', {
      method: 'POST',
      body: JSON.stringify({ action: 'list-edit-requests' }),
    });

    if (result.success && Array.isArray(result.data)) {
      setEditRequests(result.data as SwiftEditRequestRow[]);
    } else {
      setEditRequests([]);
      setError(result.error || tx('加载SWIFT修改申请失败', 'Failed to load SWIFT edit requests.'));
    }
    setEditRequestsLoading(false);
  }, [user?.role, setError, tx]);

  useEffect(() => {
    loadSwifts();
  }, [loadSwifts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSwiftEditRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSwiftEditRequests]);

  const {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteSwift,
    handleDirectCreate,
    handleSubmitSwiftEdit,
    handleReviewSwiftEdit,
  } = useSwiftActions({
    tx,
    loadSwifts,
    loadSwiftEditRequests,
    selectedFile,
    ocrResult,
    selectedDetailId,
    savedImagePath,
    directForm,
    setOcrResult,
    setImagePreview,
    setSelectedFile,
    setSavedImagePath,
    setError,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  });

  const waitingDetails = details.filter(d => d.status === 'Waiting_SWIFT');
  const isAdmin = user?.role === 'ADMIN';
  const canEditSwifts = user?.role === 'ADMIN' || user?.role === 'SALES';
  const canApproveSwiftEdits = user?.role === 'ADMIN';

  const getEditRequestStatusBadge = (status: SwiftEditRequestRow['status']) => {
    const variants: Record<SwiftEditRequestRow['status'], 'outline' | 'default' | 'destructive'> = {
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

  const openEditDialog = (swift: Swift) => {
    setEditingSwiftId(swift.id);
    setEditForm({
      date: toEditableDateValue(swift.date),
      amount: Number(swift.amount),
      senderName: swift.senderName ?? null,
      senderAddress: swift.senderAddress ?? null,
      receiverName: swift.receiverName ?? null,
      receiverAccount: swift.receiverAccount ?? null,
    });
    setShowEditDialog(true);
    setError(null);
  };

  const closeEditDialog = () => {
    if (submitting) return;
    setShowEditDialog(false);
    setEditingSwiftId(null);
  };

  const submitSwiftEdit = async () => {
    if (!editingSwiftId) return;
    const outcome = await handleSubmitSwiftEdit({
      swiftId: editingSwiftId,
      data: editForm,
      isAdmin,
    });
    if (outcome.success) {
      closeEditDialog();
    }
  };
  const getSwiftStatus = (swift: { status?: string; detailId?: string | null }) => {
    if (swift.status) return swift.status;
    if (!swift.detailId) return 'ERROR';
    const detail = details.find((d) => d.id === swift.detailId);
    if (!detail) return 'Bank_Transfer';
    if (detail.status === 'RECEIVED') return 'RECEIVED';
    if (detail.status === 'ERROR') return 'ERROR';
    return 'Bank_Transfer';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('SWIFT水单管理', 'SWIFT Management')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleShowDirectCreateChange(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => handleShowUploadChange(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {tx('上传SWIFT', 'Upload SWIFT')}
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
          <Input placeholder={tx('搜索汇款人/收款人/账号', 'Search sender/receiver/account')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={hasErrorFilter} onChange={(e) => setHasErrorFilter(e.target.value)}>
            <option value="">{tx('全部状态', 'All statuses')}</option>
            <option value="true">{tx('仅异常', 'Errors only')}</option>
            <option value="false">{tx('仅正常', 'Normal only')}</option>
          </select>
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder={tx('最小金额', 'Min amount')} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <Input type="number" placeholder={tx('最大金额', 'Max amount')} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
          <div className="md:col-span-3 lg:col-span-6 flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setDateFrom('');
                setDateTo('');
                setMinAmount('');
                setMaxAmount('');
                setHasErrorFilter('');
              }}
            >
              {tx('重置筛选', 'Reset Filters')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <SwiftList
        swifts={swifts}
        canEdit={canEditSwifts}
        tx={tx}
        getSwiftStatus={getSwiftStatus}
        onViewImage={(swift) => {
          if (!swift.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(swift.imageUrl),
            name: swift.imageName || tx('SWIFT图片', 'SWIFT image'),
          });
        }}
        onEditSwift={openEditDialog}
        onDeleteSwift={handleDeleteSwift}
      />

      {canEditSwifts && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">{tx('SWIFT修改申请', 'SWIFT Edit Requests')}</h3>
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
                    <th className="px-4 py-3">{tx('SWIFT', 'SWIFT')}</th>
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
                        <div>{`Amount: $${request.afterSnapshot.amount.toFixed(2)}`}</div>
                        <div>{`Sender: ${request.afterSnapshot.senderName ?? '-'}`}</div>
                        <div>{`Sender Address: ${request.afterSnapshot.senderAddress ?? '-'}`}</div>
                        <div>{`Receiver: ${request.afterSnapshot.receiverName ?? '-'}`}</div>
                        <div>{`Receiver Account: ${request.afterSnapshot.receiverAccount ?? '-'}`}</div>
                      </td>
                      <td className="px-4 py-3">{getEditRequestStatusBadge(request.status)}</td>
                      <td className="px-4 py-3">{new Date(request.requestedAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {request.status === 'PENDING' && canApproveSwiftEdits ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="default" onClick={() => void handleReviewSwiftEdit({ requestId: request.id, decision: 'approve' })} disabled={submitting}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void handleReviewSwiftEdit({ requestId: request.id, decision: 'reject' })} disabled={submitting}>
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
                        {tx('暂无SWIFT修改申请', 'No SWIFT edit requests')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <SwiftUploadDialog
        open={showUpload}
        waitingDetails={waitingDetails}
        uploading={uploading}
        submitting={submitting}
        selectedDetailId={selectedDetailId}
        error={error}
        imagePreview={imagePreview}
        ocrResult={ocrResult}
        tx={tx}
        onOpenChange={handleShowUploadChange}
        onSelectedDetailIdChange={setSelectedDetailId}
        onFileSelect={handleFileSelect}
        onOcrResultChange={setOcrResult}
        onConfirm={handleConfirm}
      />

      <SwiftDirectCreateDialog
        open={showDirectCreate}
        waitingDetails={waitingDetails}
        form={directForm}
        tx={tx}
        onOpenChange={handleShowDirectCreateChange}
        onFormChange={setDirectForm}
        onSubmit={handleDirectCreate}
      />

      <SwiftImagePreviewDialog
        image={viewingImage}
        onOpenChange={(open) => {
          if (!open) setViewingImage(null);
        }}
      />

      <SwiftEditDialog
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
        onSubmit={submitSwiftEdit}
      />
    </div>
  );
}
