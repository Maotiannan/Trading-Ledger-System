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
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{image?.name}</DialogTitle>
          <DialogDescription>
            {tx('查看已上传的SWIFT文件', 'Preview uploaded SWIFT file')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {image && isPdf ? (
            <PdfPreview src={image.url} fileName={image.name} tx={tx} />
          ) : image ? (
            <img src={image.url} alt={image.name} className="max-h-[70vh] w-full object-contain rounded border" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
