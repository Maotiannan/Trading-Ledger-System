'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  apiCall,
  getDisplayImageUrl,
  peekPrefetchedApiResult,
  rememberPrefetchedApiResult,
  useUiText,
} from '@/components/workspace/shared';
import { SwiftDirectCreateDialog, SwiftImagePreviewDialog, SwiftList, SwiftUploadDialog } from './components';
import { useSwiftActions, useSwiftForms } from './hooks';
import { Plus, Upload } from 'lucide-react';

export function SwiftManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { swifts, setSwifts, details } = useStore();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [hasErrorFilter, setHasErrorFilter] = useState('');
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

  useEffect(() => {
    loadSwifts();
  }, [loadSwifts]);

  const {
    uploading,
    submitting,
    handleFileSelect,
    handleConfirm,
    handleDeleteSwift,
    handleDirectCreate,
  } = useSwiftActions({
    tx,
    loadSwifts,
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
        tx={tx}
        getSwiftStatus={getSwiftStatus}
        onViewImage={(swift) => {
          if (!swift.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(swift.imageUrl),
            name: swift.imageName || tx('SWIFT图片', 'SWIFT image'),
          });
        }}
        onDeleteSwift={handleDeleteSwift}
      />

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
    </div>
  );
}
