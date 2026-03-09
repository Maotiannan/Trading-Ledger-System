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

export function SwiftManager() {
  const tx = useUiText();
  const locale = useLocale();
  const { swifts, setSwifts, details } = useStore();
  const [showUpload, setShowUpload] = useState(false);
  const [showDirectCreate, setShowDirectCreate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [savedImagePath, setSavedImagePath] = useState<{ path: string; name: string } | null>(null);
  const [viewingImage, setViewingImage] = useState<{ url: string; name: string } | null>(null);
  const [selectedDetailId, setSelectedDetailId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [hasErrorFilter, setHasErrorFilter] = useState('');
  const [directForm, setDirectForm] = useState({
    detailId: '',
    amount: '',
    date: '',
    senderName: '',
    senderAddress: '',
    receiverName: '',
    receiverAccount: '',
  });

  const loadSwifts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minAmount) params.set('minAmount', minAmount);
    if (maxAmount) params.set('maxAmount', maxAmount);
    if (hasErrorFilter) params.set('hasError', hasErrorFilter);
    const query = params.toString();
    const result = await apiCall(`swift${query ? `?${query}` : ''}`);
    if (result.success) {
      setSwifts(result.data);
    }
  }, [setSwifts, search, dateFrom, dateTo, minAmount, maxAmount, hasErrorFilter]);

  useEffect(() => {
    loadSwifts();
  }, [loadSwifts]);

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
      const result = await fetch('/api/swift', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(r => r.json());

      if (result.success) {
        setOcrResult(result.data.ocrResult);
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
    if (!selectedFile || !ocrResult || !selectedDetailId) {
      setError(tx('请选择付款明细', 'Please select a payment detail.'));
      return;
    }

    setError(null);
    setSubmitting(true);
    const formData = new FormData();
    formData.append('action', 'confirm');
    formData.append('detailId', selectedDetailId);
    formData.append('data', JSON.stringify(ocrResult));
    formData.append('imagePath', savedImagePath?.path || '');
    formData.append('imageName', savedImagePath?.name || selectedFile.name);

    try {
      const result = await fetch('/api/swift', {
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
        setSelectedDetailId('');
        loadSwifts();
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

  const handleDeleteSwift = async (swift: { id: string; hasError: boolean }) => {
    if (swift.hasError) {
      if (!confirm(tx('确定要直接删除这条错误SWIFT记录吗？', 'Delete this erroneous SWIFT record directly?'))) return;
      try {
        const result = await apiCall('swift', {
          method: 'POST',
          body: JSON.stringify({
            action: 'delete',
            swiftId: swift.id,
          }),
        });
        if (!result.success) {
          alert(result.error || tx('删除失败', 'Delete failed'));
          return;
        }
        loadSwifts();
        return;
      } catch (err) {
        alert(getErrorMessage(err, tx('删除失败', 'Delete failed')));
        return;
      }
    }

    if (!confirm(tx('确定要申请删除这条SWIFT水单吗？删除需要管理员审批。', 'Submit a deletion request for this SWIFT record? Admin approval is required.'))) return;

    const result = await apiCall('deletion', {
      method: 'POST',
      body: JSON.stringify({
        action: 'request',
        targetType: 'SWIFT',
        targetId: swift.id,
      }),
    });

    if (result.success) {
      alert(tx('删除申请已提交，等待管理员审批', 'Deletion request submitted. Waiting for admin approval.'));
      loadSwifts();
    } else {
      alert(result.error || tx('申请失败', 'Request failed'));
    }
  };

  const handleDirectCreate = async () => {
    setError(null);
    try {
      const result = await apiCall('swift', {
        method: 'POST',
        body: JSON.stringify({
          action: 'direct-create',
          detailId: directForm.detailId,
          amount: Number(directForm.amount),
          date: directForm.date || null,
          senderName: directForm.senderName || null,
          senderAddress: directForm.senderAddress || null,
          receiverName: directForm.receiverName || null,
          receiverAccount: directForm.receiverAccount || null,
        }),
      });
      if (result.success) {
        setShowDirectCreate(false);
        setDirectForm({
          detailId: '',
          amount: '',
          date: '',
          senderName: '',
          senderAddress: '',
          receiverName: '',
          receiverAccount: '',
        });
        loadSwifts();
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
        <h2 className="text-2xl font-bold">{tx('SWIFT水单管理', 'SWIFT Management')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDirectCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {tx('直接创建', 'Create Directly')}
          </Button>
          <Button onClick={() => setShowUpload(true)}>
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

      <div className="grid gap-4">
        {swifts.map((swift) => (
          <Card key={swift.id} className={swift.hasError ? 'border-red-500' : ''}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">
                    SWIFT - {swift.date ? new Date(swift.date).toLocaleDateString() : tx('日期未知', 'Unknown date')}
                  </CardTitle>
                  <CardDescription>
                    {tx(`汇款金额: $${swift.amount.toFixed(2)} | 汇款人: ${swift.senderName || '-'}`, `Amount: $${swift.amount.toFixed(2)} | Sender: ${swift.senderName || '-'}`)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getSwiftStatus(swift) === 'RECEIVED' ? 'default' : (getSwiftStatus(swift) === 'ERROR' ? 'destructive' : 'outline')}>
                    {getSwiftStatus(swift)}
                  </Badge>
                  {swift.hasError && (
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  )}
                  {swift.imageUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewingImage({ url: getDisplayImageUrl(swift.imageUrl!), name: swift.imageName || tx('SWIFT图片', 'SWIFT image') })}
                      title={tx('查看图片', 'View image')}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => handleDeleteSwift(swift)}
                    title={swift.hasError ? tx('直接删除', 'Delete directly') : tx('申请删除', 'Request deletion')}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {swift.hasError && swift.errorMessage && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{swift.errorMessage}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">{tx('汇款人:', 'Sender:')}</span> {swift.senderName}</div>
                <div><span className="text-gray-500">{tx('汇款人地址:', 'Sender Address:')}</span> {swift.senderAddress || '-'}</div>
                <div><span className="text-gray-500">{tx('收款人:', 'Receiver:')}</span> {swift.receiverName || '-'}</div>
                <div><span className="text-gray-500">{tx('收款账号:', 'Receiver Account:')}</span> {swift.receiverAccount || '-'}</div>
              </div>
            </CardContent>
          </Card>
        ))}
        {swifts.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              {tx('暂无SWIFT水单', 'No SWIFT records')}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showUpload} onOpenChange={(open) => { setShowUpload(open); if (!open) { setError(null); setOcrResult(null); setImagePreview(null); setSavedImagePath(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tx('上传SWIFT水单', 'Upload SWIFT Record')}</DialogTitle>
            <DialogDescription>{tx('上传SWIFT水单图片，AI将自动识别内容', 'Upload SWIFT image and let AI recognize content')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label>{tx('选择付款明细', 'Select Payment Detail')}</Label>
              <select 
                className="w-full mt-1 border rounded-md p-2"
                value={selectedDetailId}
                onChange={(e) => setSelectedDetailId(e.target.value)}
              >
                <option value="">{tx('请选择...', 'Please select...')}</option>
                {waitingDetails.map((detail) => (
                  <option key={detail.id} value={detail.id}>
                    {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')} - ${detail.totalAmount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>

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
                    <Label className="text-sm text-gray-500">{tx('汇款金额', 'Amount')}</Label>
                    <Input 
                      type="number"
                      value={(ocrResult.amount as number) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, amount: parseFloat(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('汇款日期', 'Transfer Date')}</Label>
                    <Input 
                      value={(ocrResult.date as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('汇款人姓名', 'Sender Name')}</Label>
                    <Input 
                      value={(ocrResult.senderName as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, senderName: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-500">{tx('收款人姓名', 'Receiver Name')}</Label>
                    <Input 
                      value={(ocrResult.receiverName as string) || ''} 
                      onChange={(e) => setOcrResult({...ocrResult, receiverName: e.target.value})}
                    />
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
            <Button onClick={handleConfirm} disabled={!ocrResult || !selectedDetailId || submitting}>
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
            <DialogTitle>{tx('直接创建SWIFT', 'Create SWIFT Directly')}</DialogTitle>
            <DialogDescription>{tx('跳过AI识别，手动录入SWIFT信息', 'Skip AI and enter SWIFT information manually')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{tx('关联付款明细', 'Linked Payment Detail')}</Label>
              <select
                className="w-full mt-1 border rounded-md p-2"
                value={directForm.detailId}
                onChange={(e) => setDirectForm((prev) => ({ ...prev, detailId: e.target.value }))}
              >
                <option value="">{tx('请选择...', 'Please select...')}</option>
                {waitingDetails.map((detail) => (
                  <option key={detail.id} value={detail.id}>
                    {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')} - ${detail.totalAmount.toFixed(2)}
                  </option>
                ))}
              </select>
            </div>
            <Input type="number" placeholder={tx('汇款金额', 'Amount')} value={directForm.amount} onChange={(e) => setDirectForm((prev) => ({ ...prev, amount: e.target.value }))} />
            <Input type="date" placeholder={tx('汇款日期', 'Transfer Date')} value={directForm.date} onChange={(e) => setDirectForm((prev) => ({ ...prev, date: e.target.value }))} />
            <Input placeholder={tx('汇款人姓名', 'Sender Name')} value={directForm.senderName} onChange={(e) => setDirectForm((prev) => ({ ...prev, senderName: e.target.value }))} />
            <Input placeholder={tx('汇款人地址', 'Sender Address')} value={directForm.senderAddress} onChange={(e) => setDirectForm((prev) => ({ ...prev, senderAddress: e.target.value }))} />
            <Input placeholder={tx('收款人姓名', 'Receiver Name')} value={directForm.receiverName} onChange={(e) => setDirectForm((prev) => ({ ...prev, receiverName: e.target.value }))} />
            <Input placeholder={tx('收款账号', 'Receiver Account')} value={directForm.receiverAccount} onChange={(e) => setDirectForm((prev) => ({ ...prev, receiverAccount: e.target.value }))} />
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

      <Dialog open={!!viewingImage} onOpenChange={(open) => { if (!open) setViewingImage(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{viewingImage?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {viewingImage && (
              <img
                src={viewingImage.url}
                alt={viewingImage.name}
                className="max-h-[70vh] w-full object-contain rounded border"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

