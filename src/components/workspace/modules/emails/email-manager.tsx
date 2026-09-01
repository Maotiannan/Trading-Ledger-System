'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import { Loader2, RefreshCw, Search, Send } from 'lucide-react';
import { EmailDeliveryHistoryDialog } from './components/email-delivery-history-dialog';
import { EmailNotificationList } from './components/email-notification-list';
import { EmailPreviewDialog } from './components/email-preview-dialog';
import {
  isEmailApprovable,
  type EmailDeliveryAttempt,
  type EmailNotificationListResponse,
  type EmailNotificationRow,
  type EmailPreviewResponse,
  type EmailTranslator,
} from './types';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const TYPE_OPTIONS = ['PAYMENT_RECEIVED', 'SHIPMENT', 'RELEASE'] as const;
const STATUS_OPTIONS = [
  'MISSING_RECIPIENT',
  'PENDING',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'DELIVERY_DELAYED',
  'BOUNCED',
  'COMPLAINED',
  'SUPPRESSED',
  'PARTIALLY_SENT',
  'FAILED',
  'DELIVERY_UNCERTAIN',
  'CANCELLED',
  'NEEDS_CORRECTION',
] as const;

type Filters = {
  search: string;
  type: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

type RowAction = 'cancel' | 'retry' | 'correction';

const EMPTY_FILTERS: Filters = {
  search: '',
  type: 'ALL',
  status: 'ALL',
  dateFrom: '',
  dateTo: '',
};

function listEndpoint(filters: Filters, page: number, pageSize: number): string {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.type !== 'ALL') params.append('type', filters.type);
  if (filters.status !== 'ALL') params.append('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  return `email-notifications?${params.toString()}`;
}

function previewRecipients(preview: EmailPreviewResponse, actual: boolean): string[] {
  const groups = actual ? preview.actualRecipients : preview.intendedRecipients;
  return groups.flatMap((group) => [...group.to, ...group.cc]);
}

export function EmailManager() {
  const t = useTranslations('emails') as EmailTranslator;
  const requestSequence = useRef(0);
  const [rows, setRows] = useState<EmailNotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRow, setPreviewRow] = useState<EmailNotificationRow | null>(null);
  const [preview, setPreview] = useState<EmailPreviewResponse | null>(null);
  const [sendPreviews, setSendPreviews] = useState<EmailPreviewResponse[]>([]);
  const [sendConfirmationOpen, setSendConfirmationOpen] = useState(false);

  const [actionConfirmation, setActionConfirmation] = useState<{
    action: RowAction;
    row: EmailNotificationRow;
  } | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRow, setHistoryRow] = useState<EmailNotificationRow | null>(null);
  const [attempts, setAttempts] = useState<EmailDeliveryAttempt[]>([]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id) && isEmailApprovable(row)),
    [rows, selectedIds],
  );

  const loadRows = useCallback(async () => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError('');
    try {
      const result = await apiCall(listEndpoint(appliedFilters, page, pageSize)) as EmailNotificationListResponse;
      if (requestSequence.current !== sequence) return;
      setRows(Array.isArray(result.data) ? result.data : []);
      setTotal(Number(result.total || 0));
      setSelectedIds(new Set());
    } catch (loadError) {
      if (requestSequence.current === sequence) {
        setError(getApiErrorMessage(loadError, t('loadFailed')));
      }
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, [appliedFilters, page, pageSize, t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows, refreshRevision]);

  const applySearch = () => {
    setAppliedFilters({ ...draftFilters });
    setPage(1);
    setRefreshRevision((value) => value + 1);
  };

  const refresh = () => setRefreshRevision((value) => value + 1);

  const toggleSelection = (row: EmailNotificationRow) => {
    if (!isEmailApprovable(row)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };

  const fetchPreview = useCallback(async (
    row: EmailNotificationRow,
    language: 'ENGLISH' | 'FRENCH' = row.language || 'ENGLISH',
  ) => apiCall('email-notifications', {
    method: 'POST',
    body: JSON.stringify({ action: 'preview', notificationId: row.id, language }),
  }) as Promise<EmailPreviewResponse>, []);

  const openPreview = async (row: EmailNotificationRow) => {
    setPreviewRow(row);
    setPreview(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    setError('');
    try {
      setPreview(await fetchPreview(row));
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, t('previewFailed')));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const changePreviewLanguage = async (language: 'ENGLISH' | 'FRENCH') => {
    if (!previewRow) return;
    setPreviewLoading(true);
    try {
      setPreview(await fetchPreview(previewRow, language));
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, t('previewFailed')));
    } finally {
      setPreviewLoading(false);
    }
  };

  const openSendConfirmation = async (
    targets: EmailNotificationRow[],
    knownPreviews: EmailPreviewResponse[] = [],
  ) => {
    if (targets.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const knownById = new Map(knownPreviews.map((item) => [item.notification.id, item]));
      const resolved = await Promise.all(targets.map((row) => (
        knownById.get(row.id) || fetchPreview(row)
      )));
      setSendPreviews(resolved);
      setSendConfirmationOpen(true);
    } catch (sendError) {
      setError(getApiErrorMessage(sendError, t('previewFailed')));
    } finally {
      setBusy(false);
    }
  };

  const performPostAction = async (body: Record<string, unknown>, successFallback: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await apiCall('email-notifications', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMessage(String(result.message || successFallback));
      setSendConfirmationOpen(false);
      setPreviewOpen(false);
      setActionConfirmation(null);
      refresh();
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t('operationFailed')));
    } finally {
      setBusy(false);
    }
  };

  const confirmSend = async () => {
    await performPostAction({
      action: 'approve',
      notificationIds: sendPreviews.map((item) => item.notification.id),
    }, t('sendQueued'));
  };

  const confirmRowAction = async () => {
    if (!actionConfirmation) return;
    const { action, row } = actionConfirmation;
    if (action === 'cancel') {
      await performPostAction({ action: 'cancel', notificationId: row.id }, t('cancelled'));
      return;
    }
    if (action === 'retry') {
      await performPostAction({
        action: 'retry',
        notificationId: row.id,
        confirmUncertain: row.status === 'DELIVERY_UNCERTAIN',
      }, t('retryQueued'));
      return;
    }
    await performPostAction({ action: 'create-correction', notificationId: row.id }, t('correctionCreated'));
  };

  const openHistory = async (row: EmailNotificationRow) => {
    setHistoryRow(row);
    setAttempts([]);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ action: 'attempts', notificationId: row.id });
      const result = await apiCall(`email-notifications?${params.toString()}`) as { data?: EmailDeliveryAttempt[] };
      setAttempts(Array.isArray(result.data) ? result.data : []);
    } catch (historyError) {
      setError(getApiErrorMessage(historyError, t('historyFailed')));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="email-manager">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{t('filters')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-1.5 md:col-span-2 xl:col-span-2">
            <Label htmlFor="email-search">{t('searchLabel')}</Label>
            <Input
              id="email-search"
              aria-label={t('searchLabel')}
              value={draftFilters.search}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('type')}</Label>
            <Select value={draftFilters.type} onValueChange={(type) => setDraftFilters((current) => ({ ...current, type }))}>
              <SelectTrigger aria-label={t('type')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('allTypes')}</SelectItem>
                {TYPE_OPTIONS.map((type) => <SelectItem key={type} value={type}>{t(`types.${type}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('status')}</Label>
            <Select value={draftFilters.status} onValueChange={(status) => setDraftFilters((current) => ({ ...current, status }))}>
              <SelectTrigger aria-label={t('status')}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="ALL">{t('allStatuses')}</SelectItem>
                {STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{t(`statuses.${status}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-date-from">{t('dateFrom')}</Label>
            <Input id="email-date-from" type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-date-to">{t('dateTo')}</Label>
            <Input id="email-date-to" type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: event.target.value }))} />
          </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-6">
            <Button type="button" onClick={applySearch} disabled={loading}>
              <Search className="h-4 w-4" /> {t('search')}
            </Button>
            <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('refresh')}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              disabled={busy || selectedRows.length === 0}
              onClick={() => void openSendConfirmation(selectedRows)}
            >
              <Send className="h-4 w-4" /> {t('sendSelected', { count: selectedRows.length })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {message ? <Alert><AlertDescription>{message}</AlertDescription></Alert> : null}

      {loading && rows.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">{t('empty')}</CardContent></Card>
      ) : (
        <div className="relative">
          {loading ? <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 animate-pulse bg-primary" /> : null}
          <EmailNotificationList
            rows={rows}
            selectedIds={selectedIds}
            busy={busy}
            t={t}
            onToggle={toggleSelection}
            onPreview={(row) => void openPreview(row)}
            onSend={(row) => void openSendConfirmation([row])}
            onCancel={(row) => setActionConfirmation({ action: 'cancel', row })}
            onRetry={(row) => setActionConfirmation({ action: 'retry', row })}
            onCorrection={(row) => setActionConfirmation({ action: 'correction', row })}
            onHistory={(row) => void openHistory(row)}
          />
        </div>
      )}

      <ListPagination
        idPrefix="email-notifications"
        tx={(zh, en) => t(en === 'Rows per page' ? 'rowsPerPage' : en === 'Previous' ? 'previous' : 'next')}
        currentPage={page}
        totalPages={totalPages}
        totalCount={total}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        disabled={loading || busy}
        onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
        onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
      />

      <EmailPreviewDialog
        open={previewOpen}
        preview={preview}
        loading={previewLoading}
        t={t}
        onOpenChange={setPreviewOpen}
        onLanguageChange={(language) => void changePreviewLanguage(language)}
        onSend={() => preview ? void openSendConfirmation([preview.notification], [preview]) : undefined}
      />

      <EmailDeliveryHistoryDialog
        open={historyOpen}
        row={historyRow}
        attempts={attempts}
        loading={historyLoading}
        t={t}
        onOpenChange={setHistoryOpen}
      />

      <AlertDialog open={sendConfirmationOpen} onOpenChange={setSendConfirmationOpen}>
        <AlertDialogContent data-testid="email-send-confirmation" className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmSendTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmSendDescription', { count: sendPreviews.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            {sendPreviews.map((item) => (
              <div key={item.notification.id} className="rounded-md border p-3">
                <div className="font-semibold">{item.notification.customerName || item.notification.mark || item.notification.id}</div>
                <div><span className="text-muted-foreground">{t('intendedRecipients')}:</span> {previewRecipients(item, false).join(', ') || '-'}</div>
                <div><span className="text-muted-foreground">{t('actualRecipients')}:</span> {previewRecipients(item, true).join(', ') || '-'}</div>
                {item.testModeRedirected ? <div className="mt-1 font-medium text-amber-700">{t('testModeNotice')}</div> : null}
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction data-testid="email-confirm-send" disabled={busy} onClick={(event) => { event.preventDefault(); void confirmSend(); }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('confirmSend')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(actionConfirmation)} onOpenChange={(open) => { if (!open) setActionConfirmation(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionConfirmation ? t(`${actionConfirmation.action}ConfirmTitle`) : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionConfirmation
                ? t(`${actionConfirmation.action}ConfirmDescription`, {
                    customer: actionConfirmation.row.customerName || actionConfirmation.row.mark || '-',
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirmRowAction(); }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
