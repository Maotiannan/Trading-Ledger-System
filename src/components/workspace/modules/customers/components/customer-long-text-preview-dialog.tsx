'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type CustomerLongTextPreviewDialogProps = {
  preview: { label: string; value: string } | null;
  onOpenChange: (open: boolean) => void;
};

export function CustomerLongTextPreviewDialog({ preview, onOpenChange }: CustomerLongTextPreviewDialogProps) {
  return (
    <Dialog open={!!preview} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{preview?.label || 'Text'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-auto rounded-md border p-3 whitespace-pre-wrap break-words text-sm">
          {preview?.value || '-'}
        </div>
      </DialogContent>
    </Dialog>
  );
}
