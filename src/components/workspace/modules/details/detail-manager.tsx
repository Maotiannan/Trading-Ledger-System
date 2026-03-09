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

export function DetailManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { details, setDetails } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ date: string | null; items: { mark: string | null; orderNo: string | null; amount: number; matchedReceiptId?: string | null }[] } | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 服务器保存的图片路径
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [directDate, setDirectDate] = useState('');
  const [directItems, setDirectItems] = useState([{ mark: '', orderNo: '', amount: '' }]);
  
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
        setDirectItems([{ mark: '', orderNo: '', amount: '' }]);
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

      <div className="space-y-4">
        {details.map((detail) => (
          <Card key={detail.id} className={detail.status === 'ERROR' ? 'border-red-500' : ''}>
            <CardHeader 
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => toggleDetail(detail.id)}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  {expandedDetails.has(detail.id) ? (
                    <ChevronDown className="h-5 w-5 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-500" />
                  )}
                  <div>
                    <CardTitle className="text-lg">
                      {tx('付款明细', 'Payment Detail')} - {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')}
                    </CardTitle>
                    <CardDescription>
                      {tx(`${detail.items.length} 笔 | 总计: $${detail.totalAmount.toFixed(2)}`, `${detail.items.length} items | Total: $${detail.totalAmount.toFixed(2)}`)}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={detail.status === 'ERROR' ? 'destructive' : 'default'}>
                    {detail.status}
                  </Badge>
                  {detail.imageUrl && (
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        setViewingImage({ url: getDisplayImageUrl(detail.imageUrl!), name: detail.imageName || tx('付款明细图片', 'Payment detail image') }); 
                      }}
                      title={tx('查看图片', 'View image')}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={(e) => { e.stopPropagation(); handleDeleteDetail(detail.id); }}
                    title={tx('申请删除', 'Request deletion')}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            
            {expandedDetails.has(detail.id) && (
              <CardContent className="border-t pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tx('唛头', 'Mark')}</TableHead>
                      <TableHead>{tx('单号', 'Order No.')}</TableHead>
                      <TableHead>{tx('金额', 'Amount')}</TableHead>
                      <TableHead>{tx('关联收据', 'Linked Receipt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.mark || '-'}</TableCell>
                        <TableCell>{item.orderNo || '-'}</TableCell>
                        <TableCell>${item.amount.toFixed(2)}</TableCell>
                        <TableCell>
                          {item.receipt ? (
                            <Badge variant="outline">{item.receipt.orderNo}</Badge>
                          ) : (
                            <span className="text-gray-400">{tx('未匹配', 'Unmatched')}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        ))}
        {details.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              {tx('暂无付款明细', 'No payment details')}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tx('上传付款明细', 'Upload Payment Detail')}</DialogTitle>
            <DialogDescription>{tx('上传付款明细图片，AI将自动识别内容', 'Upload payment detail image and let AI recognize content')}</DialogDescription>
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
                <div>
                  <Label className="text-sm text-gray-500">{tx('日期', 'Date')}</Label>
                  <Input 
                    value={ocrResult.date || ''} 
                    onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-gray-500">{tx('明细项目', 'Detail Items')}</Label>
                  {ocrResult.items.map((item, index) => (
                    <div key={index} className="grid grid-cols-3 gap-2">
                      <Input 
                        placeholder={tx('唛头', 'Mark')}
                        value={item.mark || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, mark: e.target.value};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                      <Input 
                        placeholder={tx('单号', 'Order No.')}
                        value={item.orderNo || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, orderNo: e.target.value};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                      <Input 
                        placeholder={tx('金额', 'Amount')}
                        type="number"
                        value={item.amount || ''} 
                        onChange={(e) => {
                          const newItems = [...ocrResult.items];
                          newItems[index] = {...item, amount: parseFloat(e.target.value)};
                          setOcrResult({...ocrResult, items: newItems});
                        }}
                      />
                    </div>
                  ))}
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

      <Dialog open={showDirectCreate} onOpenChange={setShowDirectCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx('直接创建付款明细', 'Create Payment Detail Directly')}</DialogTitle>
            <DialogDescription>{tx('跳过AI识别，手动录入明细行', 'Skip AI and enter detail rows manually')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} value={directDate} onChange={(e) => setDirectDate(e.target.value)} />
            {directItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-2">
                <Input
                  placeholder={tx('唛头', 'Mark')}
                  value={item.mark}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, mark: e.target.value } : row)))}
                />
                <Input
                  placeholder={tx('单号', 'Order No.')}
                  value={item.orderNo}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, orderNo: e.target.value } : row)))}
                />
                <Input
                  type="number"
                  placeholder={tx('金额', 'Amount')}
                  value={item.amount}
                  onChange={(e) => setDirectItems((prev) => prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)))}
                />
              </div>
            ))}
            <Button variant="outline" onClick={() => setDirectItems((prev) => [...prev, { mark: '', orderNo: '', amount: '' }])}>
              <Plus className="h-4 w-4 mr-2" />
              {tx('增加明细行', 'Add Detail Row')}
            </Button>
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

