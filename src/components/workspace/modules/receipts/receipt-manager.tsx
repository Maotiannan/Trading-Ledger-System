'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';
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
  useUiText,
} from '@/components/workspace/shared';
import {
  ReceiptDirectCreateDialog,
  ReceiptImagePreviewDialog,
  ReceiptList,
  ReceiptUploadDialog,
} from './components';
import { EMPTY_RECEIPT_DIRECT_FORM } from './types';
import { useReceiptCustomerLookup, useReceiptForms } from './hooks';
import {
  Loader2, Trash2, Plus, Upload, Check
} from 'lucide-react';

export function ReceiptManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  
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
    error,
    setError,
    directForm,
    setDirectForm,
    directCustomerCandidates,
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
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minUsd) params.set('minUsd', minUsd);
    if (maxUsd) params.set('maxUsd', maxUsd);
    const query = params.toString();
    const result = await apiCall(`receipt${query ? `?${query}` : ''}`);
    if (result.success) {
      setReceipts(result.data);
    }
    setLoading(false);
  }, [setReceipts, setLoading, search, statusFilter, dateFrom, dateTo, minUsd, maxUsd]);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, dateFrom, dateTo, minUsd, maxUsd]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploading(true);
    setError(null);

    // 预览
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);

    // AI识别
    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'recognize');

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
        setOcrCustomerMark('');
        setOcrCustomerName('');
        setOcrCustomerId('');
        setOcrCustomerCandidates([]);
        setSavedImagePath(result.data.image || null);
      } else {
        setSavedImagePath(null);
        setError(result.error || tx('AI识别失败，请重试', 'AI recognition failed, please retry.'));
      }
    } catch (err) {
      console.error('OCR error:', err);
      setSavedImagePath(null);
      setError(tx('网络错误，请重试', 'Network error, please retry.'));
    }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (!selectedFile || !ocrResult) return;
    if (!ocrCustomerMark.trim()) {
      setError(tx('客户MARK不能为空', 'Customer MARK is required.'));
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    const payload = {
      ...ocrResult,
      customerMark: ocrCustomerMark.trim(),
      customerName: ocrCustomerName || null,
      customerId: ocrCustomerId || null,
    };
    formData.append('action', 'confirm');
    formData.append('data', JSON.stringify(payload));
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        handleShowUploadChange(false);
        setSelectedFile(null);
        loadReceipts();
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

  const handleMarkReceived = async (receiptId: string) => {
    if (!confirm(tx('确定要标记此收据为已签收吗？', 'Mark this receipt as received?'))) return;
    
    try {
      const result = await fetch('/api/receipt', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mark-received', receiptId }),
      }).then(r => r.json());

      if (result.success) {
        loadReceipts();
      } else {
        alert(result.error || tx('操作失败', 'Operation failed'));
      }
    } catch (err) {
      alert(tx('网络错误，请重试', 'Network error, please retry.'));
      console.error(err);
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    if (!directForm.customerMark.trim()) {
      setError(tx('客户MARK不能为空', 'Customer MARK is required.'));
      return;
    }
    try {
      const result = await apiCall('receipt', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          receiptNo: directForm.receiptNo || null,
          date: directForm.date || null,
          tel: directForm.tel || null,
          usd: Number(directForm.usd),
          invNo: directForm.invNo || null,
          orderNo: directForm.orderNo || null,
          payer: directForm.payer || null,
          customerMark: directForm.customerMark || null,
          customerName: directForm.customerName || null,
          customerId: directForm.customerId || null,
          isDeposit: directForm.isDeposit,
        }),
      });
      if (result.success) {
        handleShowDirectCreateChange(false);
        resetDirectForm();
        loadReceipts();
      } else {
        setError(result.error || tx('创建失败，请重试', 'Create failed, please retry.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tx('创建失败，请重试', 'Create failed, please retry.'));
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      'SR_Received': 'secondary',
      'Waiting_SWIFT': 'outline',
      'Bank_Transfer': 'default',
      'RECEIVED': 'default'
    };
    return <Badge variant={colors[status] || 'default'}>{status}</Badge>;
  };

  const handleDeleteReceipt = async (receiptId: string) => {
    if (!confirm(tx('确定要申请删除这条收据吗？删除需要管理员审批。', 'Submit a deletion request for this receipt? Admin approval is required.'))) return;
    
    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'request', 
        targetType: 'RECEIPT', 
        targetId: receiptId 
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      loadReceipts();
    } else {
      alert(result.error || tx('申请失败', 'Request failed'));
    }
  };

  const isManager = user?.role === 'ADMIN' || user?.role === 'SALES';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx('收据管理', 'Receipt Management')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleShowDirectCreateChange(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => handleShowUploadChange(true)}>
            <Upload className="h-4 w-4 mr-2" />
            {tx('上传收据', 'Upload Receipt')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Input placeholder={tx('搜索收据号/单号/付款人', 'Search receipt/order/payer')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="border rounded-md px-3 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{tx('全部状态', 'All statuses')}</option>
            <option value="SR_Received">SR_Received</option>
            <option value="Waiting_SWIFT">Waiting_SWIFT</option>
            <option value="Bank_Transfer">Bank_Transfer</option>
            <option value="RECEIVED">RECEIVED</option>
          </select>
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('开始日期', 'Start date')} aria-label={tx('开始日期', 'Start date')} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} title={tx('结束日期', 'End date')} aria-label={tx('结束日期', 'End date')} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Input type="number" placeholder={tx('最小金额', 'Min amount')} value={minUsd} onChange={(e) => setMinUsd(e.target.value)} />
          <Input type="number" placeholder={tx('最大金额', 'Max amount')} value={maxUsd} onChange={(e) => setMaxUsd(e.target.value)} />
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
        isManager={isManager}
        tx={tx}
        getStatusBadge={getStatusBadge}
        onViewImage={(receipt) => {
          if (!receipt.imageUrl) return;
          setViewingImage({
            url: getDisplayImageUrl(receipt.imageUrl),
            name: receipt.imageName || tx('收据图片', 'Receipt image'),
          });
        }}
        onMarkReceived={handleMarkReceived}
        onDeleteReceipt={handleDeleteReceipt}
        onPreviousPage={() => setCurrentPage((page) => Math.max(1, page - 1))}
        onNextPage={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
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
        onOpenChange={handleShowDirectCreateChange}
        onFormChange={setDirectForm}
        onCustomerMarkChange={handleDirectCustomerMarkChange}
        onCustomerSelect={handleDirectCustomerSelect}
        onSubmit={handleDirectCreate}
      />

      <ReceiptImagePreviewDialog
        image={viewingImage}
        onOpenChange={(open) => {
          if (!open) setViewingImage(null);
        }}
      />
    </div>
  );
}
