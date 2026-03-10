'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type SwiftImagePreviewDialogProps = {
  image: { url: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
};

export function SwiftImagePreviewDialog({ image, onOpenChange }: SwiftImagePreviewDialogProps) {
  return (
    <Dialog open={!!image} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{image?.name}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {image && (
            <img src={image.url} alt={image.name} className="max-h-[70vh] w-full object-contain rounded border" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
