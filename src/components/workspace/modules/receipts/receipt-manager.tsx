'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CustomerCandidate,
  IMPORT_RESULT_PAGE_SIZE,
  apiCall,
  fetchCustomerCandidatesByMark,
  fetchServerDate,
  getDisplayImageUrl,
  getErrorMessage,
  initCustomerImportRowViews,
  initInvoiceImportRowViews,
  lookupCustomerByOrderNoGroup,
  mergeCustomerImportRowViews,
  mergeInvoiceImportRowViews,
  summarizeRowsForAlert,
  toCustomerImportRowResults,
  toCustomerImportRowResultsFromIssues,
  toDateInputValue,
  toInvoiceImportRowResults,
  toInvoiceImportRowResultsFromIssues,
  useUiText,
  type CustomerImportIssueRow,
  type CustomerImportRowResult,
  type CustomerImportRowView,
  type InvoiceImportIssueRow,
  type InvoiceImportRowResult,
  type InvoiceImportRowView,
} from '@/components/workspace/shared';
import {
  Loader2, LogIn, LogOut, Users, FileText, Receipt, FileSpreadsheet,
  Building2, Trash2, Plus, Upload, Check, X, AlertTriangle, Eye,
  History, ArrowRight, RefreshCw, UserPlus, Key, LayoutDashboard, Settings, Save,
  ChevronDown, ChevronRight, Pencil
} from 'lucide-react';

export function ReceiptManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { receipts, setReceipts, loading, setLoading, user } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [ocrCustomerMark, setOcrCustomerMark] = useState('');
  const [ocrCustomerName, setOcrCustomerName] = useState('');
  const [ocrCustomerId, setOcrCustomerId] = useState('');
  const [ocrCustomerCandidates, setOcrCustomerCandidates] = useState<CustomerCandidate[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [directForm, setDirectForm] = useState({
    receiptNo: '',
    date: '',
    tel: '',
    usd: '',
    invNo: '',
    orderNo: '',
    payer: '',
    customerMark: '',
    customerName: '',
    customerId: '',
    isDeposit: false,
  });
  const [directCustomerCandidates, setDirectCustomerCandidates] = useState<CustomerCandidate[]>([]);
  
  // 图片查看对话框
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [maxUsd, setMaxUsd] = useState('');
  const receiptCustomerLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 30;
  const totalPages = Math.ceil(receipts.length / pageSize);
  const paginatedReceipts = receipts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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

  useEffect(() => {
    return () => {
      if (receiptCustomerLookupTimerRef.current) {
        clearTimeout(receiptCustomerLookupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showDirectCreate) return;
    void fetchServerDate().then((serverDate) => {
      setDirectForm((prev) => ({ ...prev, date: serverDate }));
    });
  }, [showDirectCreate]);

  useEffect(() => {
    if (!showDirectCreate) return;
    const currentOrderNo = directForm.orderNo;
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
        if (!matched) return;
        setDirectForm((prev) => ({
          ...prev,
          customerMark: matched.mark,
          customerName: matched.name || prev.customerName,
          customerId: matched.customerId || prev.customerId,
        }));
        loadCustomerCandidates(
          matched.mark,
          (rows) => setDirectCustomerCandidates(rows),
          (resolvedName) => setDirectForm((prev) => ({ ...prev, customerName: resolvedName })),
          (resolvedId) => setDirectForm((prev) => ({ ...prev, customerId: resolvedId }))
        );
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [directForm.orderNo, showDirectCreate]);

  useEffect(() => {
    if (!showUpload || !ocrResult) return;
    const currentOrderNo = typeof ocrResult.orderNo === 'string' ? ocrResult.orderNo : '';
    if (!currentOrderNo.trim()) return;
    const timer = setTimeout(() => {
      void lookupCustomerByOrderNoGroup(currentOrderNo).then((matched) => {
        if (!matched) return;
        setOcrCustomerMark(matched.mark);
        setOcrCustomerName(matched.name);
        setOcrCustomerId(matched.customerId);
        loadCustomerCandidates(matched.mark, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
      });
    }, 260);
    return () => clearTimeout(timer);
  }, [ocrResult, showUpload]);

  const loadCustomerCandidates = (
    mark: string,
    setter: (rows: CustomerCandidate[]) => void,
    setDefaultName?: (value: string) => void,
    setDefaultId?: (value: string) => void
  ) => {
    const normalized = mark.trim();
    if (receiptCustomerLookupTimerRef.current) {
      clearTimeout(receiptCustomerLookupTimerRef.current);
      receiptCustomerLookupTimerRef.current = null;
    }
    if (!normalized) {
      setter([]);
      if (setDefaultName) setDefaultName('');
      if (setDefaultId) setDefaultId('');
      return;
    }
    receiptCustomerLookupTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetchCustomerCandidatesByMark(normalized);
          if (!result.success || !Array.isArray(result.data)) {
            setter([]);
            return;
          }
          const rows: CustomerCandidate[] = result.data.map((row) => ({
            id: row.id,
            mark: row.mark,
            orderName: row.orderName || row.name || '',
            displayName: row.name || '',
            phone: row.phone ?? null,
            city: row.city ?? null,
          }));
          setter(rows);
          if (rows.length === 1) {
            if (setDefaultName) setDefaultName(rows[0].orderName);
            if (setDefaultId) setDefaultId(rows[0].id);
          }
        } catch {
          setter([]);
        }
      })();
    }, 220);
  };

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
        setShowUpload(false);
        setOcrResult(null);
        setOcrCustomerMark('');
        setOcrCustomerName('');
        setOcrCustomerId('');
        setOcrCustomerCandidates([]);
        setImagePreview(null);
        setSelectedFile(null);
        setSavedImagePath(null);
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
        setShowDirectCreate(false);
        setDirectForm({
          receiptNo: '',
          date: '',
          tel: '',
          usd: '',
          invNo: '',
          orderNo: '',
          payer: '',
          customerMark: '',
          customerName: '',
          customerId: '',
          isDeposit: false,
        });
        setDirectCustomerCandidates([]);
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
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => setShowUpload(true)}>
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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
                <TableHead>{tx('客户单号', 'Order No.')}</TableHead>
                <TableHead>MARK</TableHead>
                <TableHead>{tx('付款金额', 'Amount')}</TableHead>
                <TableHead>{tx('付款人', 'Payer')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
                <TableHead>{tx('操作', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedReceipts.map((receipt) => (
                <TableRow key={receipt.id} className={receipt.needsCustomerFix ? 'bg-red-50' : ''}>
                  <TableCell>{receipt.receiptNo || '-'}</TableCell>
                  <TableCell>
                    {receipt.orderNo || '-'}
                    {receipt.needsCustomerFix && <div className="text-xs text-red-500">{tx('请修复客户信息', 'Please fix customer information')}</div>}
                  </TableCell>
                  <TableCell>{receipt.customerMark || '-'}</TableCell>
                  <TableCell className="font-medium">${receipt.usd.toFixed(2)}</TableCell>
                  <TableCell>{receipt.payer || '-'}</TableCell>
                  <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                  <TableCell>{new Date(receipt.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {receipt.imageUrl && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => setViewingImage({ url: getDisplayImageUrl(receipt.imageUrl!), name: receipt.imageName || tx('收据图片', 'Receipt image') })}
                          title={tx('查看图片', 'View image')}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      {receipt.status === 'Bank_Transfer' && isManager && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleMarkReceived(receipt.id)}
                          title={tx('签收归档', 'Mark as received')}
                          className="text-green-600 hover:text-green-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      {receipt.status !== 'RECEIVED' && receipt.status !== 'Bank_Transfer' && (
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          onClick={() => handleDeleteReceipt(receipt.id)}
                          title={tx('申请删除', 'Request deletion')}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {receipts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    {tx('暂无收据', 'No receipts')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          
          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 py-4 border-t">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                {tx('上一页', 'Previous')}
              </Button>
              <span className="text-sm text-gray-600">
                {tx(`第 ${currentPage} / ${totalPages} 页 (共 ${receipts.length} 条)`, `Page ${currentPage} / ${totalPages} (Total ${receipts.length})`)}
              </span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                {tx('下一页', 'Next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 上传对话框 */}
      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); setSavedImagePath(null); setOcrCustomerMark(''); setOcrCustomerName(''); setOcrCustomerId(''); setOcrCustomerCandidates([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tx('上传收据', 'Upload Receipt')}</DialogTitle>
            <DialogDescription>{tx('上传收据图片，AI将自动识别内容', 'Upload a receipt image and let AI recognize fields automatically')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="border-2 border-dashed rounded-lg p-4">
              <Input type="file" accept="image/*" onChange={handleFileSelect} />
            </div>

            {uploading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="ml-2">{tx('AI识别中...', 'AI recognizing...')}</span>
              </div>
            )}

            {imagePreview && (
              <div className="border rounded-lg p-2">
                <img src={imagePreview} alt="Preview" className="max-h-48 mx-auto rounded" />
              </div>
            )}

            {ocrResult && (
              <div className="space-y-3 border rounded-lg p-4">
                <h4 className="font-medium">{tx('识别结果', 'Recognition Result')}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm text-gray-500">{tx('收据号', 'Receipt No.')}</Label>
                    <Input 
                      value={(ocrResult.receiptNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, receiptNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('日期', 'Date')}</Label>
                    <Input 
                      value={(ocrResult.date as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('付款金额 (USD)', 'Amount (USD)')}</Label>
                    <Input 
                      type="number"
                      value={(ocrResult.usd as number) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, usd: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('客户单号', 'Order No.')}</Label>
                    <Input 
                      value={(ocrResult.orderNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, orderNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('账单号', 'Invoice No.')}</Label>
                    <Input 
                      value={(ocrResult.invNo as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, invNo: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('付款人', 'Payer')}</Label>
                    <Input 
                      value={(ocrResult.payer as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, payer: e.target.value})}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm text-gray-500">{tx('客户MARK（必填）', 'Customer MARK (required)')}</Label>
                    <Input
                      value={ocrCustomerMark}
                      onChange={(e) => {
                        const value = e.target.value;
                        setOcrCustomerMark(value);
                        setOcrCustomerName('');
                        setOcrCustomerId('');
                        loadCustomerCandidates(value, setOcrCustomerCandidates, setOcrCustomerName, setOcrCustomerId);
                      }}
                    />
                  </div>
                  {ocrCustomerCandidates.length > 1 && (
                    <div className="col-span-2">
                      <Label className="text-sm text-gray-500">{tx('选择准确客户(MARK+ORDER_NAME)', 'Select exact customer (MARK+ORDER_NAME)')}</Label>
                      <select
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={ocrCustomerId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setOcrCustomerId(id);
                          const selected = ocrCustomerCandidates.find((c) => c.id === id);
                          setOcrCustomerName(selected?.orderName || '');
                        }}
                      >
                        <option value="">{tx('请选择', 'Please select')}</option>
                        {ocrCustomerCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.orderName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="col-span-2">
                    <Label className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        checked={ocrResult.isDeposit as boolean} 
                        onChange={(e) => setOcrResult({...ocrResult, isDeposit: e.target.checked})}
                      />
                      {tx('这是定金 (DEPOSIT)', 'This is a deposit (DEPOSIT)')}
                    </Label>
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUpload(false);
              setOcrResult(null);
              setImagePreview(null);
            }} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleConfirm} disabled={!ocrResult || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {tx('处理中...', 'Processing...')}
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" /> {tx('确认创建', 'Confirm Create')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDirectCreate} onOpenChange={(open) => { setShowDirectCreate(open); if (!open) { setError(null); setDirectCustomerCandidates([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('直接创建收据', 'Create Receipt Directly')}</DialogTitle>
            <DialogDescription>{tx('跳过AI识别，手动录入收据信息', 'Skip AI and enter receipt information manually')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')}
              value={directForm.customerMark}
              onChange={(e) => {
                const value = e.target.value;
                setDirectForm((p) => ({ ...p, customerMark: value, customerName: '', customerId: '' }));
                loadCustomerCandidates(
                  value,
                  (rows) => setDirectCustomerCandidates(rows),
                  (name) => setDirectForm((p) => ({ ...p, customerName: name })),
                  (id) => setDirectForm((p) => ({ ...p, customerId: id }))
                );
              }}
            />
            {directCustomerCandidates.length > 1 && (
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={directForm.customerId}
                onChange={(e) => {
                  const id = e.target.value;
                  const selected = directCustomerCandidates.find((c) => c.id === id);
                  setDirectForm((p) => ({ ...p, customerId: id, customerName: selected?.orderName || '' }));
                }}
              >
                <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
                {directCustomerCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.mark} / {candidate.orderName}</option>
                ))}
              </select>
            )}
            <Input placeholder={tx('收据号', 'Receipt No.')} value={directForm.receiptNo} onChange={(e) => setDirectForm((p) => ({ ...p, receiptNo: e.target.value }))} />
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} placeholder={tx('日期', 'Date')} value={directForm.date} onChange={(e) => setDirectForm((p) => ({ ...p, date: e.target.value }))} />
            <Input placeholder={tx('电话', 'Phone')} value={directForm.tel} onChange={(e) => setDirectForm((p) => ({ ...p, tel: e.target.value }))} />
            <Input type="number" placeholder={tx('付款金额(USD)', 'Amount (USD)')} value={directForm.usd} onChange={(e) => setDirectForm((p) => ({ ...p, usd: e.target.value }))} />
            <Input placeholder={tx('账单号(invNo)', 'Invoice No. (invNo)')} value={directForm.invNo} onChange={(e) => setDirectForm((p) => ({ ...p, invNo: e.target.value }))} />
            <Input placeholder={tx('客户单号(orderNo)', 'Order No. (orderNo)')} value={directForm.orderNo} onChange={(e) => setDirectForm((p) => ({ ...p, orderNo: e.target.value }))} />
            <Input placeholder={tx('付款人', 'Payer')} value={directForm.payer} onChange={(e) => setDirectForm((p) => ({ ...p, payer: e.target.value }))} />
            <Label className="flex items-center gap-2">
              <input type="checkbox" checked={directForm.isDeposit} onChange={(e) => setDirectForm((p) => ({ ...p, isDeposit: e.target.checked }))} />
              {tx('定金', 'Deposit')}
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDirectCreate(false)}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={handleDirectCreate}>
              <Check className="h-4 w-4 mr-2" />
              {tx('创建', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图片查看对话框 */}
      <Dialog open={!!viewingImage} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewingImage?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            {viewingImage && (
              <img 
                src={viewingImage.url} 
                alt={viewingImage.name} 
                className="max-h-[70vh] object-contain rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

