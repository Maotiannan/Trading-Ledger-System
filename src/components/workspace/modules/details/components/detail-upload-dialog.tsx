'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Loader2 } from 'lucide-react';
import type { DetailOcrResult } from '../types';

export type DetailUploadDialogProps = {
  open: boolean;
  uploading: boolean;
  submitting: boolean;
  error: string | null;
  imagePreview: string | null;
  ocrResult: DetailOcrResult | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onOcrResultChange: (value: DetailOcrResult | null) => void;
  onConfirm: () => void;
};

export function DetailUploadDialog({ open, uploading, submitting, error, imagePreview, ocrResult, tx, onOpenChange, onFileSelect, onOcrResultChange, onConfirm }: DetailUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              <div>
                <Label className="text-sm text-gray-500">{tx('日期', 'Date')}</Label>
                <Input value={ocrResult.date || ''} onChange={(e) => onOcrResultChange({ ...ocrResult, date: e.target.value })} />
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
                        newItems[index] = { ...item, mark: e.target.value };
                        onOcrResultChange({ ...ocrResult, items: newItems });
                      }}
                    />
                    <Input
                      placeholder={tx('单号', 'Order No.')}
                      value={item.orderNo || ''}
                      onChange={(e) => {
                        const newItems = [...ocrResult.items];
                        newItems[index] = { ...item, orderNo: e.target.value };
                        onOcrResultChange({ ...ocrResult, items: newItems });
                      }}
                    />
                    <Input
                      placeholder={tx('金额', 'Amount')}
                      type="number"
                      value={item.amount || ''}
                      onChange={(e) => {
                        const newItems = [...ocrResult.items];
                        newItems[index] = { ...item, amount: parseFloat(e.target.value) };
                        onOcrResultChange({ ...ocrResult, items: newItems });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>{tx('取消', 'Cancel')}</Button>
          <Button onClick={onConfirm} disabled={!ocrResult || submitting}>
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
