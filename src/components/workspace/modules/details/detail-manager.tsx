'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  apiCall,
  fetchServerDate,
  getDisplayImageUrl,
  useUiText,
} from '@/components/workspace/shared';
import {
  DetailDirectCreateDialog,
  DetailImagePreviewDialog,
  DetailList,
  DetailUploadDialog,
} from './components';
import { EMPTY_DETAIL_DIRECT_ITEM, type DetailOcrResult } from './types';
import {
  Plus, Upload
} from 'lucide-react';

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<DetailOcrResult | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 服务器保存的图片路径
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [directDate, setDirectDate] = useState('');
  const [directItems, setDirectItems] = useState([{ ...EMPTY_DETAIL_DIRECT_ITEM }]);
  
  // 折叠状态
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

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

  useEffect(() => {
    if (!showDirectCreate) return;
    void fetchServerDate().then((serverDate) => {
      setDirectDate(serverDate);
    });
  }, [showDirectCreate]);

  const toggleDetail = (detailId: string) => {
    const newExpanded = new Set(expandedDetails);
    if (newExpanded.has(detailId)) {
      newExpanded.delete(detailId);
    } else {
      newExpanded.add(detailId);
    }
    setExpandedDetails(newExpanded);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        // 保存服务器返回的图片路径
        console.log('[Detail Recognize] result.data.image:', result.data.image);
        if (result.data.image) {
          setSavedImagePath(result.data.image);
        }
      } else {
        setError(result.error || tx('AI识别失败，请重试', 'AI recognition failed, please retry.'));
      }
    } catch (err) {
      console.error('OCR error:', err);
      setError(tx('网络错误，请重试', 'Network error, please retry.'));
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(ocrResult));
    // 使用服务器保存的图片路径
    console.log('[Detail Confirm] savedImagePath:', savedImagePath);
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/detail', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setShowUpload(false);
        setOcrResult(null);
        setImagePreview(null);
        setSelectedFile(null);
        setSavedImagePath(null);
        loadDetails();
      } else {
        setError(result.error || tx('创建失败，请重试', 'Create failed, please retry.'));
      }
    } catch (err) {
      console.error('Confirm error:', err);
      setError(tx('网络错误，请重试', 'Network error, please retry.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDetail = async (detailId: string) => {
    if (!confirm(tx('确定要申请删除这条付款明细吗？删除需要管理员审批。', 'Submit a deletion request for this payment detail? Admin approval is required.'))) return;
    
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'request', 
        targetType: 'DETAIL', 
        targetId: detailId 
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      loadDetails();
    } else {
      alert(result.error || tx('申请失败', 'Request failed'));
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const payloadItems = directItems
        .filter((item) => item.amount && Number(item.amount) > 0)
        .map((item) => ({
          mark: item.mark || null,
          orderNo: item.orderNo || null,
          amount: Number(item.amount),
        }));

      const result = await apiCall('detail', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          date: directDate || null,
          items: payloadItems,
        }),
      });

      if (result.success) {
        setShowDirectCreate(false);
        setDirectDate('');
        setDirectItems([{ ...EMPTY_DETAIL_DIRECT_ITEM }]);
        loadDetails();
      } else {
        setError(result.error || tx('创建失败', 'Create failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('创建失败', 'Create failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('付款明细管理', 'Payment Detail Management')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => setShowUpload(true)}>
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
        onOpenChange={(open) => {
          setShowUpload(open);
          if (!open) {
            setError(null);
            setOcrResult(null);
            setImagePreview(null);
          }
        }}
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
        onOpenChange={setShowDirectCreate}
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
