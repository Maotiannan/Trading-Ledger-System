'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Check, Loader2 } from 'lucide-react';
import type { CustomerCandidate } from '@/components/workspace/shared';
import type { ReceiptOcrUploadStatus } from '../types';

export type ReceiptUploadDialogProps = {
  open: boolean;
  uploading: boolean;
  submitting: boolean;
  error: string | null;
  imagePreview: string | null;
  ocrResult: Record<string, unknown> | null;
  ocrCustomerMark: string;
  ocrCustomerId: string;
  ocrCustomerCandidates: CustomerCandidate[];
  ocrInvConflict: boolean;
  ocrInvConflictCount: number;
  ocrUploadStatus: ReceiptOcrUploadStatus;
  ocrUploadMessage: string | null;
  ocrUploadProgress: number | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOcrResultChange: (value: Record<string, unknown>) => void;
  onOcrCustomerMarkChange: (value: string) => void;
  onOcrCustomerSelect: (customerId: string) => void;
  onConfirm: () => void;
};

export function ReceiptUploadDialog({
  open,
  uploading,
  submitting,
  error,
  imagePreview,
  ocrResult,
  ocrCustomerMark,
  ocrCustomerId,
  ocrCustomerCandidates,
  ocrInvConflict,
  ocrInvConflictCount,
  ocrUploadStatus,
  ocrUploadMessage,
  ocrUploadProgress,
  tx,
  onOpenChange,
  onFileSelect,
  onOcrResultChange,
  onOcrCustomerMarkChange,
  onOcrCustomerSelect,
  onConfirm,
}: ReceiptUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Input type="file" accept="image/*" onChange={onFileSelect} />
          </div>

          {ocrUploadStatus !== 'idle' && ocrUploadMessage && (
            <div className="rounded-lg border px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {(ocrUploadStatus === 'compressing' || ocrUploadStatus === 'uploading' || ocrUploadStatus === 'saving') && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                <span>{ocrUploadMessage}</span>
              </div>
              {(ocrUploadStatus === 'uploading' || ocrUploadStatus === 'saving') && (
                <Progress value={ocrUploadStatus === 'saving' ? 100 : (ocrUploadProgress ?? 0)} />
              )}
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
                  <Input value={(ocrResult.receiptNo as string) || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, receiptNo: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('日期', 'Date')}</Label>
                  <Input value={(ocrResult.date as string) || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('付款金额 (USD)', 'Amount (USD)')}</Label>
                  <Input type="number" value={(ocrResult.usd as number) || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, usd: parseFloat(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('客户单号', 'Order No.')}</Label>
                  <Input value={(ocrResult.orderNo as string) || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, orderNo: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('账单号', 'Invoice No.')}</Label>
                  <Input
                    value={(ocrResult.invNo as string) || ''}
                    onChange={(e) => onOcrResultChange({ ...ocrResult, invNo: e.target.value })}
                    className={ocrInvConflict ? 'border-red-500 text-red-600 focus-visible:ring-red-500' : ''}
                  />
                  {ocrInvConflict && (
                    <p className="mt-1 text-xs text-red-600">
                      {tx(`该 ORDER 命中 ${ocrInvConflictCount} 个发票号，当前已自动选用最新一条，请核对。`, `This ORDER matched ${ocrInvConflictCount} invoice numbers. The latest one was auto-selected. Please verify.`)}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('付款人', 'Payer')}</Label>
                  <Input value={(ocrResult.payer as string) || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, payer: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label className="text-sm text-gray-500">{tx('客户MARK（必填）', 'Customer MARK (required)')}</Label>
                  <Input value={ocrCustomerMark} onChange={(e) => onOcrCustomerMarkChange(e.target.value)} />
                </div>
                {ocrCustomerCandidates.length > 1 && (
                  <div className="col-span-2">
                    <Label className="text-sm text-gray-500">{tx('选择准确客户(MARK+ORDER_NAME)', 'Select exact customer (MARK+ORDER_NAME)')}</Label>
                    <select className="w-full border rounded-md px-3 py-2 text-sm" value={ocrCustomerId} onChange={(e) => onOcrCustomerSelect(e.target.value)}>
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
                      checked={Boolean(ocrResult.isDeposit)}
                      onChange={(e) => onOcrResultChange({ ...ocrResult, isDeposit: e.target.checked })}
                    />
                    {tx('这是定金 (DEPOSIT)', 'This is a deposit (DEPOSIT)')}
                  </Label>
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onConfirm} disabled={!ocrResult || submitting || uploading}>
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
  );
}
