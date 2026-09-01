'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';
import type { EmailPreviewResponse, EmailTranslator } from '../types';

function AddressList({ addresses }: { addresses: string[] }) {
  if (addresses.length === 0) return <span>-</span>;
  return <span className="break-all">{addresses.join(', ')}</span>;
}

function RecipientGroups({
  groups,
  t,
}: {
  groups: Array<{ to: string[]; cc: string[] }>;
  t: EmailTranslator;
}) {
  return (
    <div className="space-y-2">
      {groups.map((group, index) => (
        <div key={`${group.to.join(',')}-${index}`} className="rounded-md border p-3 text-sm">
          <div><span className="font-medium">{t('to')}:</span> <AddressList addresses={group.to} /></div>
          <div><span className="font-medium">{t('cc')}:</span> <AddressList addresses={group.cc} /></div>
        </div>
      ))}
    </div>
  );
}

export function EmailPreviewDialog({
  open,
  preview,
  loading,
  t,
  onOpenChange,
  onLanguageChange,
  onSend,
}: {
  open: boolean;
  preview: EmailPreviewResponse | null;
  loading: boolean;
  t: EmailTranslator;
  onOpenChange: (open: boolean) => void;
  onLanguageChange: (language: 'ENGLISH' | 'FRENCH') => void;
  onSend: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="email-preview-dialog"
        className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b p-4 pr-12 sm:p-6 sm:pr-12">
          <DialogTitle>{t('previewTitle')}</DialogTitle>
          <DialogDescription>{t('previewDescription')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {loading || !preview ? (
            <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('language')}</Label>
                  <Select value={preview.language} onValueChange={(value) => onLanguageChange(value as 'ENGLISH' | 'FRENCH')}>
                    <SelectTrigger aria-label={t('language')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ENGLISH">{t('languages.ENGLISH')}</SelectItem>
                      <SelectItem value="FRENCH">{t('languages.FRENCH')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-md bg-muted p-3 text-sm">
                  <div className="font-medium">{preview.testModeRedirected ? t('testModeNotice') : t('liveModeNotice')}</div>
                  <div>{t('templateVersion', { version: preview.preview.templateVersion })}</div>
                </div>
              </div>
              <section className="space-y-2">
                <h3 className="font-semibold">{t('intendedRecipients')}</h3>
                <RecipientGroups groups={preview.intendedRecipients} t={t} />
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">{t('actualRecipients')}</h3>
                <RecipientGroups groups={preview.actualRecipients} t={t} />
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">{t('subject')}</h3>
                <div className="rounded-md border p-3">{preview.preview.subject}</div>
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">{t('htmlPreview')}</h3>
                <iframe
                  title={t('htmlPreview')}
                  sandbox=""
                  srcDoc={preview.preview.html}
                  className="h-[420px] w-full rounded-md border bg-white"
                />
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">{t('plainText')}</h3>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm">{preview.preview.text}</pre>
              </section>
            </div>
          )}
        </div>
        <DialogFooter className="border-t bg-background p-4 sm:p-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
          {preview && !preview.missingRecipient && preview.notification.status === 'PENDING' ? (
            <Button type="button" data-testid="email-preview-send" disabled={loading} onClick={onSend}>
              <Send className="h-4 w-4" /> {t('send')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
