'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAppDateTime } from '@/lib/app-time';
import { Eye, History, PencilLine, RotateCcw, Send, XCircle } from 'lucide-react';
import {
  isEmailApprovable,
  notificationOrderNos,
  type EmailNotificationRow,
  type EmailTranslator,
} from '../types';

type Props = {
  rows: EmailNotificationRow[];
  selectedIds: Set<string>;
  busy: boolean;
  t: EmailTranslator;
  onToggle: (row: EmailNotificationRow) => void;
  onPreview: (row: EmailNotificationRow) => void;
  onSend: (row: EmailNotificationRow) => void;
  onCancel: (row: EmailNotificationRow) => void;
  onRetry: (row: EmailNotificationRow) => void;
  onCorrection: (row: EmailNotificationRow) => void;
  onHistory: (row: EmailNotificationRow) => void;
};

const PREVIEWABLE = new Set(['PENDING', 'MISSING_RECIPIENT']);
const CANCELLABLE = new Set(['PENDING', 'MISSING_RECIPIENT', 'QUEUED', 'FAILED']);
const RETRYABLE = new Set(['FAILED', 'PARTIALLY_SENT', 'DELIVERY_UNCERTAIN']);

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'DELIVERED' || status === 'SENT') return 'default';
  if (['FAILED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED'].includes(status)) return 'destructive';
  if (status === 'PENDING' || status === 'QUEUED' || status === 'SENDING') return 'secondary';
  return 'outline';
}

function ActionButton({
  testId,
  label,
  onClick,
  disabled,
  children,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 px-2"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="ml-1 hidden xl:inline">{label}</span>
    </Button>
  );
}

export function EmailNotificationList({
  rows,
  selectedIds,
  busy,
  t,
  onToggle,
  onPreview,
  onSend,
  onCancel,
  onRetry,
  onCorrection,
  onHistory,
}: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background">
      <Table className="min-w-[1180px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"><span className="sr-only">{t('select')}</span></TableHead>
            <TableHead>{t('createdAt')}</TableHead>
            <TableHead>{t('type')}</TableHead>
            <TableHead>{t('customer')}</TableHead>
            <TableHead>{t('recipient')}</TableHead>
            <TableHead>{t('language')}</TableHead>
            <TableHead>{t('source')}</TableHead>
            <TableHead>{t('orderNo')}</TableHead>
            <TableHead>{t('status')}</TableHead>
            <TableHead className="text-right">{t('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const approvable = isEmailApprovable(row);
            const source = row.receiptNo
              ? `${t('receiptSource')}: ${row.receiptNo}`
              : row.invoiceNo
                ? `${t('invoiceSource')}: ${row.invoiceNo}`
                : row.eventKey;
            return (
              <TableRow key={row.id} data-testid={`email-row-${row.id}`}>
                <TableCell>
                  <Checkbox
                    data-testid={`email-select-${row.id}`}
                    aria-label={`${t('select')} ${row.customerName || row.mark || row.id}`}
                    checked={selectedIds.has(row.id)}
                    disabled={busy || !approvable}
                    onCheckedChange={() => onToggle(row)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatAppDateTime(row.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap">{t(`types.${row.type}`)}</TableCell>
                <TableCell>
                  <div className="font-medium">{row.customerName || '-'}</div>
                  <div className="text-xs text-muted-foreground">{row.mark || '-'}</div>
                </TableCell>
                <TableCell>
                  <div>{row.primaryEmail || '-'}</div>
                  {row.additionalEmailCount > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {t('additionalEmails', { count: row.additionalEmailCount })}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{row.language ? t(`languages.${row.language}`) : '-'}</TableCell>
                <TableCell className="whitespace-nowrap">{source}</TableCell>
                <TableCell className="max-w-[220px] whitespace-normal font-medium">
                  {notificationOrderNos(row).join(' / ') || '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{t(`statuses.${row.status}`)}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    {PREVIEWABLE.has(row.status) ? (
                      <ActionButton testId={`email-preview-${row.id}`} label={t('preview')} disabled={busy} onClick={() => onPreview(row)}>
                        <Eye className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                    {approvable ? (
                      <ActionButton testId={`email-send-${row.id}`} label={t('send')} disabled={busy} onClick={() => onSend(row)}>
                        <Send className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                    {CANCELLABLE.has(row.status) ? (
                      <ActionButton testId={`email-cancel-${row.id}`} label={t('cancel')} disabled={busy} onClick={() => onCancel(row)}>
                        <XCircle className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                    {RETRYABLE.has(row.status) ? (
                      <ActionButton testId={`email-retry-${row.id}`} label={t('retry')} disabled={busy} onClick={() => onRetry(row)}>
                        <RotateCcw className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                    {row.status === 'NEEDS_CORRECTION' ? (
                      <ActionButton testId={`email-correction-${row.id}`} label={t('correction')} disabled={busy} onClick={() => onCorrection(row)}>
                        <PencilLine className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                    {row.deliveries.length > 0 ? (
                      <ActionButton testId={`email-history-${row.id}`} label={t('history')} disabled={busy} onClick={() => onHistory(row)}>
                        <History className="h-4 w-4" />
                      </ActionButton>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
