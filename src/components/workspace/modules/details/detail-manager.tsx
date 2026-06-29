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
import { StatusMultiSelectFilter } from '@/components/workspace/modules/shared/status-multi-select-filter';
import { useListPageSizePreference } from '@/components/workspace/modules/shared/use-list-page-size-preference';
import { submitSearchOnEnter } from '@/components/workspace/shared/search-key';
import {
  apiCall,
  getErrorMessage,
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
import type { DetailDirectSelectableReceipt, PaymentAgentSummary } from './types';
import { Building2, Plus, Upload } from 'lucide-react';

const detailStatusOptions = ['Waiting_SWIFT', 'Bank_Transfer', 'RECEIVED', 'ERROR'] as const;
const defaultDetailStatuses = detailStatusOptions.filter((status) => status !== 'RECEIVED');

type DetailFilterState = {
  search: string;
  statuses: string[];
  dateFrom: string;
  dateTo: string;
  amount: string;
};

const defaultDetailFilters: DetailFilterState = {
  search: '',
  statuses: defaultDetailStatuses,
  dateFrom: '',
  dateTo: '',
  amount: '',
};

function formatDetailPreviewImageName(name: string) {
  return name.replace(/^payment-detail(?=[_.-])/i, 'Payment-Detail');
}

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails, user } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(defaultDetailStatuses);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amount, setAmount] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<DetailFilterState>(defaultDetailFilters);
  const [filterRequestVersion, setFilterRequestVersion] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize, pageSizeOptions, savePageSize } = useListPageSizePreference('detail');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [editingDetailId, setEditingDetailId] = useState<string | null>(null);
  const [editLinkedReceiptLabels, setEditLinkedReceiptLabels] = useState<string[]>([]);
  const [agents, setAgents] = useState<PaymentAgentSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [directSelectableReceipts, setDirectSelectableReceipts] = useState<DetailDirectSelectableReceipt[]>([]);
  const [directSelectableReceiptsLoading, setDirectSelectableReceiptsLoading] = useState(false);
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
    directSelectedReceiptIds,
    setDirectSelectedReceiptIds,
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
  const directReceiptRequestGuard = useLatestRequestGuard();
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

  const loadDirectSelectableReceipts = useCallback(async () => {
    const requestToken = directReceiptRequestGuard.nextToken();
    setDirectSelectableReceiptsLoading(true);
    try {
      const result = await apiCall('receipt?status=SR_Received');
      if (!directReceiptRequestGuard.isLatest(requestToken)) return;
      if (result.success && Array.isArray(result.data)) {
        setDirectSelectableReceipts(
          (result.data as DetailDirectSelectableReceipt[]).filter((receipt) => receipt.status === 'SR_Received')
        );
      } else {
        setDirectSelectableReceipts([]);
        setError(getErrorMessage(result, tx('加载可加入收据失败', 'Failed to load selectable receipts')));
      }
    } catch (error) {
      if (!directReceiptRequestGuard.isLatest(requestToken)) return;
      setDirectSelectableReceipts([]);
      setError(getErrorMessage(error, tx('加载可加入收据失败', 'Failed to load selectable receipts')));
    } finally {
      if (directReceiptRequestGuard.isLatest(requestToken)) {
        setDirectSelectableReceiptsLoading(false);
      }
    }
  }, [directReceiptRequestGuard, tx, setError]);

  const loadDetails = useCallback(async () => {
    const requestToken = detailRequestGuard.nextToken();
    const params = new URLSearchParams();
    const trimmedSearch = appliedFilters.search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    for (const status of appliedFilters.statuses) params.append('status', status);
    if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
    if (appliedFilters.amount) params.set('amount', appliedFilters.amount);
    const query = params.toString();
    const endpoint = `detail${query ? `?${query}` : ''}`;
    const canUsePrefetch =
      !trimmedSearch &&
      appliedFilters.statuses.length === defaultDetailStatuses.length &&
      appliedFilters.statuses.every((status) => defaultDetailStatuses.includes(status as typeof defaultDetailStatuses[number])) &&
      !appliedFilters.dateFrom &&
      !appliedFilters.dateTo &&
      !appliedFilters.amount;
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
  }, [appliedFilters, detailRequestGuard, details, setDetails]);

  useEffect(() => {
    loadDetails();
  }, [filterRequestVersion, loadDetails]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (!showDirectCreate) {
      setDirectSelectableReceipts([]);
      return;
    }
    void loadDirectSelectableReceipts();
  }, [loadDirectSelectableReceipts, showDirectCreate]);

  const directSelectedReceipts = directSelectableReceipts.filter((receipt) => directSelectedReceiptIds.includes(receipt.id));

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
    directSelectedReceipts,
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

  const resetToFirstPage = () => setCurrentPage(1);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((prev) => {
      const next = prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status];
      return detailStatusOptions.filter((option) => next.includes(option));
    });
    resetToFirstPage();
  };

  const toggleAllStatuses = () => {
    setStatusFilter((prev) => (
      prev.length === detailStatusOptions.length ? [] : [...detailStatusOptions]
    ));
    resetToFirstPage();
  };

  const applyFilters = (searchOverride?: string) => {
    setAppliedFilters({
      search: searchOverride ?? search,
      statuses: statusFilter,
      dateFrom,
      dateTo,
      amount,
    });
    resetToFirstPage();
    setFilterRequestVersion((version) => version + 1);
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter(defaultDetailStatuses);
    setDateFrom('');
    setDateTo('');
    setAmount('');
    setAppliedFilters(defaultDetailFilters);
    resetToFirstPage();
    setFilterRequestVersion((version) => version + 1);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    savePageSize(nextPageSize);
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(details.length / pageSize));
  const paginatedDetails = details.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const statusSummary = statusFilter.length === detailStatusOptions.length
    ? tx('全部状态', 'All statuses')
    : tx(`已选 ${statusFilter.length} 个状态`, `${statusFilter.length} statuses`);

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
          <Input
            placeholder={tx('搜索唛头/单号', 'Search mark/order no.')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetToFirstPage(); }}
            onKeyDown={(event) => submitSearchOnEnter(event, (value) => {
              setSearch(value);
              applyFilters(value);
            })}
          />
        )}
        renderFilters={() => (
          <>
            <StatusMultiSelectFilter
              label={tx('状态筛选', 'Status Filter')}
              summary={statusSummary}
              allLabel={tx('全部状态', 'All statuses')}
              options={detailStatusOptions.map((status) => ({ value: status }))}
              selected={statusFilter}
              onToggleStatus={toggleStatusFilter}
              onToggleAll={toggleAllStatuses}
            />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
            <MoneyInput placeholder={tx('准确总金额', 'Exact total amount')} value={amount} onValueChange={(value) => { setAmount(value); resetToFirstPage(); }} />
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
            <Button onClick={() => applyFilters()}>{tx('查询', 'Search')}</Button>
          </div>
        )}
      />

      <DetailList
        details={paginatedDetails}
        expandedDetails={expandedDetails}
        canEdit={canEditDetails}
        isAdmin={isAdmin}
        tx={tx}
        onToggleDetail={toggleDetail}
        onViewImage={(detail) => {
          setViewingImage({
            url: `/api/detail?action=preview-image&detailId=${encodeURIComponent(detail.id)}`,
            name: detail.imageName ? formatDetailPreviewImageName(detail.imageName) : tx('付款明细图片', 'Payment detail image'),
          });
        }}
        onEditDetail={openEditDialog}
        onExportDetailPic={handleExportDetailPic}
        onDeleteDetail={handleDeleteDetail}
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={details.length}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
        onPageSizeChange={handlePageSizeChange}
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
        agents={agents}
        agentsLoading={agentsLoading}
        selectedAgentId={selectedAgentId}
        selectableReceipts={directSelectableReceipts}
        selectedReceiptIds={directSelectedReceiptIds}
        selectableReceiptsLoading={directSelectableReceiptsLoading}
        tx={tx}
        onOpenChange={handleShowDirectCreateChange}
        onDirectDateChange={setDirectDate}
        onDirectItemsChange={setDirectItems}
        onSelectedAgentIdChange={setSelectedAgentId}
        onSelectedReceiptIdsChange={setDirectSelectedReceiptIds}
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
