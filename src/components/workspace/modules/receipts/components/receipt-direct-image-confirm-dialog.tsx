'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { PendingDirectImageSelection } from '../types';

export type ReceiptDirectImageConfirmDialogProps = {
  selection: PendingDirectImageSelection | null;
  tx: (zh: string, en: string) => string;
  uploading: boolean;
  uploadMessage: string | null;
  uploadProgress: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function ReceiptDirectImageConfirmDialog({
  selection,
  tx,
  uploading,
  uploadMessage,
  uploadProgress,
  onOpenChange,
  onConfirm,
}: ReceiptDirectImageConfirmDialogProps) {
  return (
    <Dialog open={!!selection} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[min(92vw,72rem)] sm:rounded-lg sm:p-0">
        <DialogTitle className="sr-only">{tx('确认收据图片', 'Confirm receipt image')}</DialogTitle>
        <DialogDescription className="sr-only">
          {tx('确认当前图片后才会开始上传。', 'The selected image will be uploaded only after confirmation.')}
        </DialogDescription>
        <div className="flex h-full min-h-0 flex-col bg-background">
          <div
            data-testid="receipt-direct-image-confirm-header"
            className="sticky top-0 z-10 grid grid-cols-[auto,minmax(0,1fr),auto] items-center gap-2 border-b bg-background px-4 py-3"
          >
            <Button type="button" variant="ghost" disabled={uploading} onClick={() => onOpenChange(false)}>
              {tx('返回重选', 'Back')}
            </Button>
            <div className="min-w-0 px-2 text-center text-sm font-medium truncate">
              {selection?.name || tx('确认收据图片', 'Confirm receipt image')}
            </div>
            <Button type="button" disabled={!selection || uploading} onClick={onConfirm}>
              {uploading ? tx('上传中...', 'Uploading...') : tx('确认上传', 'Confirm Upload')}
            </Button>
          </div>
          <div
            data-testid="receipt-direct-image-preview-region"
            className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 sm:p-6"
          >
            {selection && (
              <div className="flex min-h-full items-start justify-center sm:items-center">
                <img
                  src={selection.previewUrl}
                  alt={selection.name}
                  className="mx-auto block w-full max-w-full max-h-[calc(100dvh-10rem)] rounded-lg object-contain shadow-sm sm:max-h-[calc(90dvh-12rem)]"
                />
              </div>
            )}
          </div>
          {(uploadMessage || typeof uploadProgress === 'number') && (
            <div className="border-t px-4 py-3 text-sm text-muted-foreground">
              <div>{uploadMessage || tx('正在上传图片...', 'Uploading image...')}</div>
              {typeof uploadProgress === 'number' && uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-1">{uploadProgress}%</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
