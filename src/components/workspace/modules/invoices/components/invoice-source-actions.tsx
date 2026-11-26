'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import type { Invoice } from '@/lib/store';
import { downloadFileName } from '@/lib/download-file-name';

export function InvoiceSourceActions({ invoice, tx, onChanged }: {
  invoice: Invoice; tx: (zh: string, en: string) => string; onChanged?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const intent = useRef<{ revision: string; requestId: string } | null>(null);
  const source = invoice.source;
  if (!source) return null;
  const label = tx('从 MuCont 最近成功生成版本重新同步订单与应收，保留收款', 'Restore orders and amounts from the latest successful MuCont generation; keep receipts');
  const resync = async () => {
    if (!source.revision || busy) return;
    if (intent.current?.revision !== source.revision) intent.current = { revision: source.revision, requestId: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(invoice.id)}/resync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: intent.current.requestId, expectedRevision: source.revision }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { intent.current = null; await onChanged?.(); }
        throw new Error(data.error?.message || label);
      }
      intent.current = null;
      await onChanged?.();
      toast({ title: tx('已重新同步，原收款保持不变', 'Synchronized; existing receipts are unchanged') });
    } catch (error) {
      toast({ variant: 'destructive', title: error instanceof Error ? error.message : tx('重新同步失败', 'Synchronization failed') });
    } finally { setBusy(false); }
  };
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(invoice.id)}/bill-of-lading`);
      if (!response.ok) throw new Error(tx('提单暂不可用，请刷新后重试', 'Bill of lading unavailable; refresh and retry'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const disposition = response.headers.get('content-disposition') || '';
      anchor.download = downloadFileName(disposition, `${invoice.invNo}-BL.pdf`);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast({ variant: 'destructive', title: error instanceof Error ? error.message : 'Download failed' }); }
    finally { setBusy(false); }
  };
  return <span className="inline-flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
    {source.canResync && <Button variant="ghost" size="icon" title={label} aria-label={label} disabled={busy} onClick={() => void resync()}>
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
    </Button>}
    {source.canDownloadBillOfLading && <Button variant="ghost" size="icon" title={tx('下载最新提单', 'Download current B/L')}
      aria-label={tx('下载最新提单', 'Download current B/L')} disabled={busy} onClick={() => void download()}><Download /></Button>}
  </span>;
}
