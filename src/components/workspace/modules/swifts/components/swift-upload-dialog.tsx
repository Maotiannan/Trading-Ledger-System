'use client';

import type { Detail } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Loader2 } from 'lucide-react';
import type { SwiftOcrResult } from '../types';

export type SwiftUploadDialogProps = {
  open: boolean;
  waitingDetails: Detail[];
  uploading: boolean;
  submitting: boolean;
  selectedDetailId: string;
  error: string | null;
  imagePreview: string | null;
  ocrResult: SwiftOcrResult | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onSelectedDetailIdChange: (value: string) => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOcrResultChange: (value: SwiftOcrResult | null) => void;
  onConfirm: () => void;
};

export function SwiftUploadDialog({
  open,
  waitingDetails,
  uploading,
  submitting,
  selectedDetailId,
  error,
  imagePreview,
  ocrResult,
  tx,
  onOpenChange,
  onSelectedDetailIdChange,
  onFileSelect,
  onOcrResultChange,
  onConfirm,
}: SwiftUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <select className="w-full mt-1 border rounded-md p-2" value={selectedDetailId} onChange={(e) => onSelectedDetailIdChange(e.target.value)}>
              <option value="">{tx('请选择...', 'Please select...')}</option>
              {waitingDetails.map((detail) => (
                <option key={detail.id} value={detail.id}>
                  {detail.date ? new Date(detail.date).toLocaleDateString() : tx('日期未知', 'Unknown date')} - ${detail.totalAmount.toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div className="border-2 border-dashed rounded-lg p-4">
            <Input type="file" accept="image/*" onChange={onFileSelect} />
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
                    value={ocrResult.amount || ''}
                    onChange={(e) => onOcrResultChange({ ...ocrResult, amount: parseFloat(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('汇款日期', 'Transfer Date')}</Label>
                  <Input
                    value={ocrResult.date || ''}
                    onChange={(e) => onOcrResultChange({ ...ocrResult, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('汇款人姓名', 'Sender Name')}</Label>
                  <Input
                    value={ocrResult.senderName || ''}
                    onChange={(e) => onOcrResultChange({ ...ocrResult, senderName: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-sm text-gray-500">{tx('收款人姓名', 'Receiver Name')}</Label>
                  <Input
                    value={ocrResult.receiverName || ''}
                    onChange={(e) => onOcrResultChange({ ...ocrResult, receiverName: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onConfirm} disabled={!ocrResult || !selectedDetailId || submitting}>
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
