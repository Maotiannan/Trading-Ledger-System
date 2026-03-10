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
  useUiText,
} from '@/components/workspace/shared';
import {
  DetailDirectCreateDialog,
  DetailImagePreviewDialog,
  DetailList,
  DetailUploadDialog,
} from './components';
import { useDetailActions, useDetailForms } from './hooks';
import { Plus, Upload } from 'lucide-react';

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails } = useStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

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
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    const query = params.toString();
    const result = await apiCall(`detail${query ? `?${query}` : ''}`);
    if (result.success) {
      setDetails(result.data);
    }
  }, [setDetails, search, statusFilter, dateFrom, dateTo, minAmount, maxAmount]);

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
  } = useDetailActions({
    tx,
    loadDetails,
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
    handleShowUploadChange,
    handleShowDirectCreateChange,
    resetDirectForm,
  });

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
        tx={tx}
        onToggleDetail={toggleDetail}
        onViewImage={(detail) => {
          if (!detail.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(detail.imageUrl),
            name: detail.imageName || tx('付款明细图片', 'Payment detail image'),
          });
        }}
        onDeleteDetail={handleDeleteDetail}
      />

      <DetailUploadDialog
        open={showUpload}
        uploading={uploading}
        submitting={submitting}
        error={error}
        imagePreview={imagePreview}
        ocrResult={ocrResult}
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
    </div>
  );
}
