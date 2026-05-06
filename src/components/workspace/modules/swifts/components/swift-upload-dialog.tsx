'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Check, Loader2 } from 'lucide-react';
import type { SwiftDetailOption, SwiftOcrResult, SwiftOcrUploadStatus } from '../types';
import { normalizeSwiftAmount, normalizeSwiftReceiverAccount } from '@/lib/swift-normalization';

export type SwiftUploadDialogProps = {
  open: boolean;
  waitingDetails: SwiftDetailOption[];
  waitingDetailsLoading: boolean;
  uploading: boolean;
  submitting: boolean;
  selectedDetailId: string;
  error: string | null;
  imagePreview: string | null;
  ocrResult: SwiftOcrResult | null;
  ocrUploadStatus: SwiftOcrUploadStatus;
  ocrUploadMessage: string | null;
  ocrUploadProgress: number | null;
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
  waitingDetailsLoading,
  uploading,
  submitting,
  selectedDetailId,
  error,
  imagePreview,
  ocrResult,
  ocrUploadStatus,
  ocrUploadMessage,
  ocrUploadProgress,
  tx,
  onOpenChange,
  onSelectedDetailIdChange,
  onFileSelect,
  onOcrResultChange,
  onConfirm,
}: SwiftUploadDialogProps) {
  const updateAmount = (value: string) => {
    onOcrResultChange({ ...ocrResult, amount: normalizeSwiftAmount(value) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] p-0 overflow-hidden max-h-[90vh] sm:max-w-2xl">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>{tx('上传SWIFT水单', 'Upload SWIFT Record')}</DialogTitle>
            <DialogDescription>{tx('上传SWIFT水单图片，AI将自动识别内容', 'Upload SWIFT image and let AI recognize content')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div>
                <Label>{tx('选择付款明细', 'Select Payment Detail')}</Label>
                <select className="w-full mt-1 border rounded-md p-2" value={selectedDetailId} onChange={(e) => onSelectedDetailIdChange(e.target.value)}>
                  <option value="">{waitingDetailsLoading ? tx('加载中...', 'Loading...') : tx('请选择...', 'Please select...')}</option>
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
                  <img src={imagePreview} alt="Preview" className="max-h-64 mx-auto rounded" />
                </div>
              )}

              {ocrResult && (
                <div className="space-y-3 border rounded-lg p-4">
                  <h4 className="font-medium">{tx('识别结果', 'Recognition Result')}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-sm text-gray-500">{tx('汇款金额', 'Amount')}</Label>
                      <Input
                        type="number"
                        value={ocrResult.amount ?? ''}
                        onChange={(e) => updateAmount(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">{tx('汇款日期', 'Transfer Date')}</Label>
                      <Input
                        value={ocrResult.date || ''}
                        onChange={(e) => onOcrResultChange({ ...ocrResult, date: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">{tx('付款人姓名', 'Sender Name')}</Label>
                      <Input
                        value={ocrResult.senderName || ''}
                        onChange={(e) => onOcrResultChange({ ...ocrResult, senderName: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">{tx('付款人地址', 'Sender Address')}</Label>
                      <Input
                        value={ocrResult.senderAddress || ''}
                        onChange={(e) => onOcrResultChange({ ...ocrResult, senderAddress: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">{tx('收款人姓名', 'Receiver Name')}</Label>
                      <Input
                        value={ocrResult.receiverName || ''}
                        onChange={(e) => onOcrResultChange({ ...ocrResult, receiverName: e.target.value || null })}
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-gray-500">{tx('收款人银行账号', 'Receiver Account')}</Label>
                      <Input
                        value={ocrResult.receiverAccount || ''}
                        onChange={(e) => onOcrResultChange({ ...ocrResult, receiverAccount: normalizeSwiftReceiverAccount(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4 flex-col-reverse gap-2 sm:flex-row sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
            <Button onClick={onConfirm} disabled={!ocrResult || !selectedDetailId || submitting || uploading || waitingDetailsLoading}>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
