'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DetailImagePreviewDialogProps = {
  image: { url: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
};

export function DetailImagePreviewDialog({ image, onOpenChange }: DetailImagePreviewDialogProps) {
  return (
    <Dialog open={!!image} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{image?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center">
          {image && <img src={image.url} alt={image.name} className="max-h-[70vh] object-contain rounded-lg" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
