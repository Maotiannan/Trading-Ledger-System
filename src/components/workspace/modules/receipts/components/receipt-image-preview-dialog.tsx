'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatOrderNameDisplay } from '@/lib/display-format';

export type ReceiptImagePreviewInfo = {
  url: string;
  alt: string;
  orderNo: string;
  invNo: string;
  creator: string;
};

export type ReceiptImagePreviewDialogProps = {
  image: ReceiptImagePreviewInfo | null;
  onOpenChange: (open: boolean) => void;
  tx?: (zh: string, en: string) => string;
};

export function ReceiptImagePreviewDialog({ image, onOpenChange, tx }: ReceiptImagePreviewDialogProps) {
  const text = tx || ((zh: string) => zh);
  return (
    <Dialog open={!!image} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{text('收据图片', 'Receipt image')}</DialogTitle>
          <DialogDescription className="sr-only">
            {text('收据图片绑定信息', 'Receipt image binding information')}
          </DialogDescription>
        </DialogHeader>
        {image && (
          <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <div>{`${text('已绑定ORDER NO：', 'Bound ORDER NO: ')}${formatOrderNameDisplay(image.orderNo)}`}</div>
            <div>{`${text('已绑定发票号：', 'Bound invoice: ')}${image.invNo}`}</div>
            <div>{`${text('创建者：', 'Creator: ')}${image.creator}`}</div>
          </div>
        )}
        <div className="flex justify-center">
          {image && <img src={image.url} alt={image.alt} className="max-h-[70vh] object-contain rounded-lg" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
