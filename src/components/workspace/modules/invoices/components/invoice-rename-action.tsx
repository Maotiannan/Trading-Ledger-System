'use client';

import { useId, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { apiCall } from '@/components/workspace/api/client';
import { clearDashboardSummaryCache } from '@/components/workspace/modules/dashboard/dashboard-summary-cache';
import { clearCustomerHistoryCache } from '@/components/workspace/modules/dashboard/customer-history-cache';
import { SYSTEM_POOL_INVOICE_NOS } from '@/lib/payment-type-classifier';
import type { Invoice } from '@/lib/store';

export function InvoiceRenameAction({ invoice, isAdmin, tx, onChanged }: {
  invoice: Invoice; isAdmin: boolean; tx: (zh: string, en: string) => string; onChanged?: () => void | Promise<void>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [invNo, setInvNo] = useState(invoice.invNo);
  const [expectedInvNo, setExpectedInvNo] = useState(invoice.invNo);
  const [busy, setBusy] = useState(false);
  if (!isAdmin || SYSTEM_POOL_INVOICE_NOS.has(invoice.invNo)) return null;
  const title = tx('修改整单 INV NO', 'Change invoice number');
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !invNo.trim()) return;
    setBusy(true);
    try {
      await apiCall('invoice', { method: 'PUT', body: JSON.stringify({
        action: 'renameInvoice', invoiceId: invoice.id, expectedInvNo, invNo: invNo.trim(),
      }) });
      clearDashboardSummaryCache();
      clearCustomerHistoryCache();
      await onChanged?.();
      setOpen(false);
      toast({ title: tx('INV NO 已修改，关联收款保持不变', 'Invoice number updated; linked payments are unchanged') });
    } catch (error) {
      toast({ variant: 'destructive', title: error instanceof Error ? error.message : tx('修改失败', 'Update failed') });
    } finally { setBusy(false); }
  };
  return <span className="inline-flex shrink-0" onClick={event => event.stopPropagation()}>
    <Dialog open={open} onOpenChange={next => {
      if (busy) return;
      if (next) { setInvNo(invoice.invNo); setExpectedInvNo(invoice.invNo); }
      setOpen(next);
    }}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" className="size-8" title={title} aria-label={title}>
        <Pencil className="size-4" />
      </Button></DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <form onSubmit={event => void save(event)} className="flex min-w-0 flex-col gap-4">
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
            {tx('整张发票及关联收款将显示新号，金额和订单不变。已生成的文件保留原样。',
              'The whole invoice and linked payments will use the new number. Amounts and orders stay unchanged. Existing files are preserved.')}
          </DialogDescription></DialogHeader>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={inputId}>INV NO</Label>
            <Input id={inputId} value={invNo} onChange={event => setInvNo(event.target.value)} maxLength={191} disabled={busy} autoComplete="off" required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{tx('取消', 'Cancel')}</Button>
            <Button type="submit" disabled={busy || !invNo.trim() || invNo.trim() === expectedInvNo}>
              {busy && <Loader2 className="size-4 animate-spin" />}{tx('保存', 'Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </span>;
}
