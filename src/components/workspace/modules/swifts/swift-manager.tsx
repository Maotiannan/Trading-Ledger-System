'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore, type Swift } from '@/lib/store';
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
  getDisplayImageUrl,
  peekPrefetchedApiResult,
  rememberPrefetchedApiResult,
  useLatestRequestGuard,
  useUiText,
} from '@/components/workspace/shared';
import { SwiftDirectCreateDialog, SwiftEditDialog, SwiftImagePreviewDialog, SwiftList, SwiftUploadDialog } from './components';
import { useSwiftActions, useSwiftForms } from './hooks';
import type { SwiftEditablePatch } from '@/lib/swift-edit-types';
import type { SwiftDetailOption } from './types';
import { Plus, Upload } from 'lucide-react';

const swiftStatusOptions = ['Bank_Transfer', 'ERROR', 'RECEIVED'] as const;
const defaultSwiftStatuses = swiftStatusOptions.filter((status) => status !== 'RECEIVED');

type SwiftFilterState = {
  search: string;
  statuses: string[];
  dateFrom: string;
  dateTo: string;
  amount: string;
};

const defaultSwiftFilters: SwiftFilterState = {
  search: '',
  statuses: defaultSwiftStatuses,
  dateFrom: '',
  dateTo: '',
  amount: '',
};

export function SwiftManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { swifts, setSwifts, details, user } = useStore();
  const [waitingDetailsOptions, setWaitingDetailsOptions] = useState<SwiftDetailOption[]>([]);
  const [waitingDetailsLoading, setWaitingDetailsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(defaultSwiftStatuses);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amount, setAmount] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<SwiftFilterState>(defaultSwiftFilters);
  const [filterRequestVersion, setFilterRequestVersion] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const { pageSize, pageSizeOptions, savePageSize } = useListPageSizePreference('swift');
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
    ocrUploadStatus,
    setOcrUploadStatus,
    ocrUploadMessage,
    setOcrUploadMessage,
    ocrUploadProgress,
    setOcrUploadProgress,
    directForm,
    setDirectForm,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  } = useSwiftForms();
  const swiftRequestGuard = useLatestRequestGuard();

  const loadSwifts = useCallback(async () => {
    const requestToken = swiftRequestGuard.nextToken();
    const params = new URLSearchParams();
    const trimmedSearch = appliedFilters.search.trim();
    if (trimmedSearch) params.set('search', trimmedSearch);
    for (const status of appliedFilters.statuses) params.append('status', status);
    if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
    if (appliedFilters.amount) params.set('amount', appliedFilters.amount);
    const query = params.toString();
    const endpoint = `swift${query ? `?${query}` : ''}`;
    const canUsePrefetch =
      !trimmedSearch &&
      appliedFilters.statuses.length === defaultSwiftStatuses.length &&
      appliedFilters.statuses.every((status) => defaultSwiftStatuses.includes(status as typeof defaultSwiftStatuses[number])) &&
      !appliedFilters.dateFrom &&
      !appliedFilters.dateTo &&
      !appliedFilters.amount;
    const cachedResult = canUsePrefetch ? peekPrefetchedApiResult<{ success?: boolean; data?: typeof swifts }>(endpoint) : null;
    if (cachedResult?.success && Array.isArray(cachedResult.data) && swiftRequestGuard.isLatest(requestToken)) {
      setSwifts(cachedResult.data);
    }
    const result = await apiCall(endpoint);
    if (!swiftRequestGuard.isLatest(requestToken)) return;
    if (result.success) {
      setSwifts(result.data);
      if (canUsePrefetch) {
        rememberPrefetchedApiResult(endpoint, result);
      }
    }
  }, [appliedFilters, setSwifts, swiftRequestGuard, swifts]);

  useEffect(() => {
    loadSwifts();
  }, [filterRequestVersion, loadSwifts]);

  const {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteSwift,
    handleMarkSwiftReceived,
    handleDirectCreate,
    handleSubmitSwiftEdit,
  } = useSwiftActions({
    tx,
    loadSwifts,
    loadSwiftEditRequests: useCallback(async () => {}, []),
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
    setOcrUploadStatus,
    setOcrUploadMessage,
    setOcrUploadProgress,
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  });

  const loadWaitingDetailsOptions = useCallback(async () => {
    setWaitingDetailsLoading(true);
    try {
      const result = await apiCall('detail?action=waiting-options');
      if (!result.success || !Array.isArray(result.data)) {
        setWaitingDetailsOptions([]);
        return;
      }
      setWaitingDetailsOptions(result.data as SwiftDetailOption[]);
    } finally {
      setWaitingDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showUpload && !showDirectCreate) return;
    void loadWaitingDetailsOptions();
  }, [loadWaitingDetailsOptions, showDirectCreate, showUpload]);

  const waitingDetails = waitingDetailsOptions.length > 0
    ? waitingDetailsOptions
    : details
      .filter((detail) => detail.status === 'Waiting_SWIFT')
      .map((detail) => ({
        id: detail.id,
        date: detail.date,
        totalAmount: detail.totalAmount,
      }));

  const isAdmin = user?.role === 'ADMIN';
  const canEditSwifts = user?.role === 'ADMIN' || user?.role === 'SALES';
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

  const resetToFirstPage = () => setCurrentPage(1);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter((prev) => {
      const next = prev.includes(status) ? prev.filter((item) => item !== status) : [...prev, status];
      return swiftStatusOptions.filter((option) => next.includes(option));
    });
    resetToFirstPage();
  };

  const toggleAllStatuses = () => {
    setStatusFilter((prev) => (
      prev.length === swiftStatusOptions.length ? [] : [...swiftStatusOptions]
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
    setStatusFilter(defaultSwiftStatuses);
    setDateFrom('');
    setDateTo('');
    setAmount('');
    setAppliedFilters(defaultSwiftFilters);
    resetToFirstPage();
    setFilterRequestVersion((version) => version + 1);
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    savePageSize(nextPageSize);
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(swifts.length / pageSize));
  const paginatedSwifts = swifts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const statusSummary = statusFilter.length === swiftStatusOptions.length
    ? tx('全部状态', 'All statuses')
    : tx(`已选 ${statusFilter.length} 个状态`, `${statusFilter.length} statuses`);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold">{tx('SWIFT水单管理', 'SWIFT Management')}</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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

      <ResponsiveFilterCard
        testIdPrefix="swift"
        filterLabel={tx('筛选', 'Filters')}
        renderSearch={() => (
          <Input
            placeholder={tx('搜索汇款人/收款人/账号', 'Search sender/receiver/account')}
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
              options={swiftStatusOptions.map((status) => ({ value: status }))}
              selected={statusFilter}
              onToggleStatus={toggleStatusFilter}
              onToggleAll={toggleAllStatuses}
            />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetToFirstPage(); }} />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetToFirstPage(); }} />
            <MoneyInput placeholder={tx('准确金额', 'Exact amount')} value={amount} onValueChange={(value) => { setAmount(value); resetToFirstPage(); }} />
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

      <SwiftList
        swifts={paginatedSwifts}
        isAdmin={isAdmin}
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
        onMarkReceived={handleMarkSwiftReceived}
        onDeleteSwift={handleDeleteSwift}
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={swifts.length}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
        onPageSizeChange={handlePageSizeChange}
      />

        <SwiftUploadDialog
          open={showUpload}
          waitingDetails={waitingDetails}
          waitingDetailsLoading={waitingDetailsLoading}
          uploading={uploading}
          submitting={submitting}
          selectedDetailId={selectedDetailId}
          error={error}
          imagePreview={imagePreview}
          ocrResult={ocrResult}
          ocrUploadStatus={ocrUploadStatus}
          ocrUploadMessage={ocrUploadMessage}
          ocrUploadProgress={ocrUploadProgress}
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
          waitingDetailsLoading={waitingDetailsLoading}
          form={directForm}
          tx={tx}
        onOpenChange={handleShowDirectCreateChange}
        onFormChange={setDirectForm}
        onSubmit={handleDirectCreate}
      />

      <SwiftImagePreviewDialog
        image={viewingImage}
        tx={tx}
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
