'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isPdfPreviewSource, PdfPreview } from '@/components/workspace/modules/shared/pdf-preview';

export type SwiftImagePreviewDialogProps = {
  image: { url: string; name: string } | null;
  tx?: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
};

function defaultTx(zh: string) {
  return zh;
}

export function SwiftImagePreviewDialog({ image, tx = defaultTx, onOpenChange }: SwiftImagePreviewDialogProps) {
  const isPdf = image ? isPdfPreviewSource(image.url, image.name) : false;

  return (
    <Dialog open={!!image} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="min-w-0 shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
          <DialogTitle className="min-w-0 break-all text-base sm:text-lg">{image?.name}</DialogTitle>
          <DialogDescription>
            {tx('查看已上传的SWIFT文件', 'Preview uploaded SWIFT file')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden px-2 py-2 sm:px-6">
          {image && isPdf ? (
            <PdfPreview src={image.url} fileName={image.name} tx={tx} className="h-full max-h-full" />
          ) : image ? (
            <img src={image.url} alt={image.name} className="max-h-[calc(100dvh-9rem)] w-full max-w-full object-contain rounded border" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
