'use client';

import { useRef } from 'react';
import type { CustomerCandidate } from '@/components/workspace/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatOrderNameDisplay } from '@/lib/display-format';
import { Check, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DirectImageUploadStatus, ReceiptDirectForm } from '../types';

export type ReceiptDirectCreateDialogProps = {
  open: boolean;
  locale: string;
  form: ReceiptDirectForm;
  customerCandidates: CustomerCandidate[];
  tx: (zh: string, en: string) => string;
  uploadedImageName: string;
  directUploading: boolean;
  directUploadStatus: DirectImageUploadStatus;
  directUploadMessage: string | null;
  directUploadProgress: number | null;
  invConflict: boolean;
  invConflictCount: number;
  onOpenChange: (open: boolean) => void;
  onFormChange: (value: ReceiptDirectForm) => void;
  onCustomerMarkChange: (value: string) => void;
  onCustomerSelect: (customerId: string) => void;
  onImageSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
};

export function ReceiptDirectCreateDialog({
  open,
  locale,
  form,
  customerCandidates,
  tx,
  uploadedImageName,
  directUploading,
  directUploadStatus,
  directUploadMessage,
  directUploadProgress,
  invConflict,
  invConflictCount,
  onOpenChange,
  onFormChange,
  onCustomerMarkChange,
  onCustomerSelect,
  onImageSelect,
  onSubmit,
}: ReceiptDirectCreateDialogProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('直接创建收据', 'Create Receipt Directly')}</DialogTitle>
          <DialogDescription>{tx('跳过AI识别，手动录入收据信息', 'Skip AI and enter receipt information manually')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input placeholder={tx('客户单号(orderNo)', 'Order No. (orderNo)')} value={form.orderNo} onChange={(e) => onFormChange({ ...form, orderNo: e.target.value })} />
          <div className="space-y-1">
            <Input
              placeholder={tx('账单号(invNo)', 'Invoice No. (invNo)')}
              value={form.invNo}
              onChange={(e) => onFormChange({ ...form, invNo: e.target.value })}
              className={invConflict ? 'border-red-500 text-red-600 focus-visible:ring-red-500' : ''}
            />
            {invConflict && (
              <p className="text-xs text-red-600">
                {tx(`该 ORDER 命中 ${invConflictCount} 个发票号，当前已自动选用最新一条，请核对。`, `This ORDER matched ${invConflictCount} invoice numbers. The latest one was auto-selected. Please verify.`)}
              </p>
            )}
          </div>
          <Input placeholder={tx('客户MARK(必填)', 'Customer MARK (required)')} value={form.customerMark} onChange={(e) => onCustomerMarkChange(e.target.value)} />
          <MoneyInput placeholder={tx('付款金额(USD)', 'Amount (USD)')} value={form.usd} onValueChange={(value) => onFormChange({ ...form, usd: value })} />
          {customerCandidates.length > 1 && (
            <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.customerId} onChange={(e) => onCustomerSelect(e.target.value)}>
              <option value="">{tx('请选择准确客户(MARK+ORDER_NAME)', 'Please select exact customer (MARK+ORDER_NAME)')}</option>
              {customerCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.mark} / {formatOrderNameDisplay(candidate.orderName)}</option>
              ))}
            </select>
          )}
          <div className="space-y-2">
            <Label htmlFor="receipt-direct-image-upload">{tx('收据图片', 'Receipt image')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={directUploading} onClick={() => cameraInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                {tx('拍照', 'Take Photo')}
              </Button>
              <Input
                id="receipt-direct-image-upload"
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onImageSelect}
              />
              <Button type="button" variant="outline" disabled={directUploading} onClick={() => galleryInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                {tx('从相册选择', 'Choose from Gallery')}
              </Button>
              <Input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onImageSelect}
              />
              <span className="text-sm text-muted-foreground truncate">
                {uploadedImageName || tx('未选择图片', 'No image selected')}
              </span>
            </div>
            {directUploadMessage && (
              <div className="space-y-2">
                <p
                  className={cn(
                    'text-sm',
                    directUploadStatus === 'failed'
                      ? 'text-red-600'
                      : directUploadStatus === 'success'
                        ? 'text-green-600'
                        : 'text-muted-foreground',
                  )}
                >
                  {directUploadMessage}
                </p>
                {(directUploadStatus === 'uploading' || directUploadStatus === 'saving') && (
                  <Progress value={directUploadStatus === 'saving' ? 100 : (directUploadProgress ?? 0)} />
                )}
              </div>
            )}
          </div>
          <Input placeholder={tx('收据号', 'Receipt No.')} value={form.receiptNo} onChange={(e) => onFormChange({ ...form, receiptNo: e.target.value })} />
          <Input type="date" lang={locale === 'en' ? 'en-CA' : 'zh-CN'} placeholder={tx('日期', 'Date')} value={form.date} onChange={(e) => onFormChange({ ...form, date: e.target.value })} />
          <Input placeholder={tx('电话', 'Phone')} value={form.tel} onChange={(e) => onFormChange({ ...form, tel: e.target.value })} />
          <Input placeholder={tx('付款人', 'Payer')} value={form.payer} onChange={(e) => onFormChange({ ...form, payer: e.target.value })} />
          <Label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isDeposit} onChange={(e) => onFormChange({ ...form, isDeposit: e.target.checked })} />
            {tx('定金', 'Deposit')}
          </Label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onSubmit}>
            <Check className="h-4 w-4 mr-2" />
            {tx('创建', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
