'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore, type Detail } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
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
  DetailDirectCreateDialog,
  DetailEditDialog,
  DetailImagePreviewDialog,
  DetailList,
  PaymentAgentManagerDialog,
  DetailUploadDialog,
} from './components';
import { useDetailActions, useDetailForms } from './hooks';
import type { DetailEditablePatch } from '@/lib/detail-edit-types';
import type { PaymentAgentSummary } from './types';
import { Building2, Plus, Upload } from 'lucide-react';

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails, user } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amount, setAmount] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [editLinkedReceiptLabels, setEditLinkedReceiptLabels] = useState<string[]>([]);
  const [agents, setAgents] = useState<PaymentAgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [editForm, setEditForm] = useState<DetailEditablePatch>({
    date: null,
    agentId: null,
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
    selectedAgentId,
    setSelectedAgentId,
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
  const editPreviewTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const result = await apiCall('agent');
      if (result.success && Array.isArray(result.data)) {
        setAgents(result.data as PaymentAgentSummary[]);
      }
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async () => {
    const requestToken = detailRequestGuard.nextToken();
    const params = new URLSearchParams();
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (amount) params.set('amount', amount);
    const query = params.toString();
    const endpoint = `detail${query ? `?${query}` : ''}`;
    const canUsePrefetch = !trimmedSearch && !statusFilter && !dateFrom && !dateTo && !amount;
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
  }, [amount, dateFrom, dateTo, detailRequestGuard, details, search, setDetails, statusFilter]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

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
    selectedAgentId,
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
      const orderNo = item.receipt.orderNo?.trim();
      if (orderNo) return orderNo;
      return tx('已关联收据', 'Linked receipt');
    }));
    setEditForm({
      date: toEditableDateValue(detail.date),
      agentId: detail.agentId ?? null,
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
    for (const timer of editPreviewTimersRef.current.values()) {
      clearTimeout(timer);
    }
    editPreviewTimersRef.current.clear();
    setShowEditDialog(false);
    setEditingDetailId(null);
    setEditLinkedReceiptLabels([]);
  };

  const handleEditItemChange = useCallback((index: number, patch: { mark?: string | null; orderNo?: string | null; amount?: number }) => {
    setEditForm((prev) => {
      const nextItems = prev.items.map((current, currentIndex) => {
        if (currentIndex !== index) return current;
        return {
          ...current,
          ...(patch.mark !== undefined ? { mark: patch.mark } : {}),
          ...(patch.orderNo !== undefined ? { orderNo: patch.orderNo } : {}),
          ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
          ...(patch.orderNo !== undefined ? { receiptId: null } : {}),
        };
      });
      return { ...prev, items: nextItems };
    });

    if (patch.orderNo === undefined && patch.amount === undefined) {
      return;
    }

    const existingTimer = editPreviewTimersRef.current.get(index);
    if (existingTimer) {
      clearTimeout(existingTimer);
      editPreviewTimersRef.current.delete(index);
    }

    const timer = setTimeout(async () => {
      const currentRow = editForm.items[index];
      const nextOrderNo = patch.orderNo !== undefined ? patch.orderNo : currentRow?.orderNo;
      const nextAmount = patch.amount !== undefined ? patch.amount : currentRow?.amount;
      const trimmedOrderNo = String(nextOrderNo || '').trim();
      if (!trimmedOrderNo) {
        setEditLinkedReceiptLabels((prev) => prev.map((label, labelIndex) => (
          labelIndex === index ? tx('未匹配', 'Unmatched') : label
        )));
        return;
      }

      try {
        const query = new URLSearchParams({
          action: 'order-preview',
          orderNo: trimmedOrderNo,
          amount: String(Number(nextAmount || 0)),
        });
        const result = await apiCall(`detail?${query.toString()}`);
        if (!result.success || !result.data || typeof result.data !== 'object') return;
        const payload = result.data as {
          matchedReceiptId?: string | null;
          linkedReceiptLabel?: string | null;
          suggestedMark?: string | null;
          willCreateReceipt?: boolean;
        };

        setEditLinkedReceiptLabels((prev) => prev.map((label, labelIndex) => {
          if (labelIndex !== index) return label;
          if (payload.linkedReceiptLabel) return payload.linkedReceiptLabel;
          if (payload.willCreateReceipt) return tx('保存后将创建新收据', 'A new receipt will be created on save');
          return tx('未匹配', 'Unmatched');
        }));

        setEditForm((prev) => {
          const nextItems = prev.items.map((current, currentIndex) => {
            if (currentIndex !== index) return current;
            if (String(current.orderNo || '').trim() !== trimmedOrderNo) return current;
            return {
              ...current,
              mark: payload.suggestedMark ?? current.mark,
              receiptId: payload.matchedReceiptId ?? null,
            };
          });
          return { ...prev, items: nextItems };
        });
      } catch {
        // keep current draft; preview is best-effort only
      }
    }, 260);

    editPreviewTimersRef.current.set(index, timer);
  }, [editForm.items, tx]);

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
          <Button variant="outline" onClick={() => setShowAgentManager(true)}>
            <Building2 className="mr-2 h-4 w-4" />
            {tx('付款代理', 'AGENT')}
          </Button>
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

      <ResponsiveFilterCard
        testIdPrefix="detail"
        filterLabel={tx('筛选', 'Filters')}
        renderSearch={() => (
          <Input placeholder={tx('搜索唛头/单号', 'Search mark/order no.')} value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        renderFilters={() => (
          <>
            <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{tx('全部状态', 'All statuses')}</option>
              <option value="Waiting_SWIFT">Waiting_SWIFT</option>
              <option value="Bank_Transfer">Bank_Transfer</option>
              <option value="RECEIVED">RECEIVED</option>
              <option value="ERROR">ERROR</option>
            </select>
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <MoneyInput placeholder={tx('准确总金额', 'Exact total amount')} value={amount} onValueChange={setAmount} />
          </>
        )}
        renderActions={() => (
          <div className="flex justify-end md:col-span-3 lg:col-span-6">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setAmount('');
              }}
            >
              {tx('重置筛选', 'Reset Filters')}
            </Button>
          </div>
        )}
      />

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
        agents={agents}
        agentsLoading={agentsLoading}
        selectedAgentId={selectedAgentId}
        tx={tx}
        onOpenChange={handleShowUploadChange}
        onSelectedAgentIdChange={setSelectedAgentId}
        onFileSelect={handleFileSelect}
        onOcrResultChange={setOcrResult}
        onConfirm={handleConfirm}
      />

      <PaymentAgentManagerDialog
        open={showAgentManager}
        agents={agents}
        loading={agentsLoading}
        tx={tx}
        onOpenChange={setShowAgentManager}
        onAgentsReload={loadAgents}
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
        agents={agents}
        agentsLoading={agentsLoading}
        linkedReceiptLabels={editLinkedReceiptLabels}
        submitting={submitting}
        isAdmin={isAdmin}
        tx={tx}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
          else setShowEditDialog(true);
        }}
        onFormChange={setEditForm}
        onItemChange={handleEditItemChange}
        onSubmit={submitDetailEdit}
      />
    </div>
  );
}
