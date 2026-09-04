'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatAppDateTime } from '@/lib/app-time';
import { Loader2 } from 'lucide-react';
import type {
  EmailDeliveryAttempt,
  EmailNotificationRow,
  EmailTranslator,
} from '../types';

export function EmailDeliveryHistoryDialog({
  open,
  row,
  attempts,
  loading,
  t,
  onOpenChange,
}: {
  open: boolean;
  row: EmailNotificationRow | null;
  attempts: EmailDeliveryAttempt[];
  loading: boolean;
  t: EmailTranslator;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b p-4 pr-12 sm:p-6 sm:pr-12">
          <DialogTitle>{t('historyTitle')}</DialogTitle>
          <DialogDescription>{row?.customerName || row?.mark || '-'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : attempts.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{t('noAttempts')}</p>
          ) : (
            <div className="space-y-3">
              {attempts.map((attempt) => (
                <article key={attempt.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{t('attemptNumber', { number: attempt.attemptNo })}</strong>
                    <Badge variant={attempt.status === 'ACCEPTED' ? 'default' : attempt.status === 'STARTED' ? 'secondary' : 'destructive'}>
                      {t(`attemptStatuses.${attempt.status}`)}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">{t('startedAt')}</dt><dd>{formatAppDateTime(attempt.startedAt)}</dd></div>
                    <div><dt className="text-muted-foreground">{t('finishedAt')}</dt><dd>{formatAppDateTime(attempt.finishedAt)}</dd></div>
                    <div><dt className="text-muted-foreground">{t('providerMessageId')}</dt><dd className="break-all">{attempt.providerMessageId || '-'}</dd></div>
                    <div><dt className="text-muted-foreground">{t('failure')}</dt><dd>{attempt.failureCode || attempt.failureMessage || '-'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="border-t bg-background p-4 sm:p-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
