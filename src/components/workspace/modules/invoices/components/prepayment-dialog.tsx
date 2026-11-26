'use client';

import { useRef, useState } from 'react';
import { Wallet, Loader2, Search, Undo2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiCall } from '@/components/workspace/api/client';
import { useUiText } from '@/components/workspace/shared';
import { MoneyInput } from '@/components/workspace/modules/shared/money-input';
import { formatUsdAmount } from '@/lib/display-format';

type Credit = { creditId: string; customerLabel: string; sourceOrderNo: string; receiptNo: string | null;
  availableAmount: string; usedAmount: string; reservedAmount: string; held: boolean; transferred: boolean; revision: string };
type Transfer = { id: string; amount: string; reason: string; createdAt: string; reversedAt: string | null };
type Target = { binding: { type: 'LEDGER_ORDER' | 'LEDGER_TRACKER' | 'LEDGER_SOURCE'; id: string };
  customerId: string; customerLabel: string; orderNo: string; invoiceNo: string | null };
type CreditResponse = { credits: Credit[]; transfers: Transfer[]; canTransfer: boolean };
async function apiRequest<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  return apiCall(endpoint.replace(/^\//, ''), options) as Promise<T>;
}

export function PrepaymentDialog({ onChanged, initialCreditId }: { onChanged: () => void; initialCreditId?: string }) {
  const tx = useUiText();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<CreditResponse | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Credit | null>(null);
  const [query, setQuery] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reversing, setReversing] = useState<Transfer | null>(null);
  const [message, setMessage] = useState('');
  const intent = useRef<{ key: string; requestId: string } | null>(null);
  const searchVersion = useRef(0);

  const load = async (selectInitial = false) => {
    setLoading(true);
    try {
      const result = await apiRequest<{ success: boolean; data: CreditResponse }>('/prepayment-transfers');
      setData(result.data);
      if (selectInitial && initialCreditId) setSelected(result.data.credits.find(row => row.creditId === initialCreditId) || null);
    } catch (e) { setError(e instanceof Error ? e.message : tx('加载失败', 'Loading failed')); }
    finally { setLoading(false); }
  };
  const resetForm = () => { setSelected(null); setReversing(null); setTarget(null); setTargets([]); setQuery(''); setAmount(''); setReason(''); intent.current = null; searchVersion.current++; };
  const search = async () => {
    const current = ++searchVersion.current;
    setError(''); setTarget(null);
    try {
      const result = await apiRequest<{ data: { targets: Target[] } }>(`/prepayment-transfers?action=targets&search=${encodeURIComponent(query)}`);
      if (current === searchVersion.current) setTargets(result.data.targets);
    } catch (e) { if (current === searchVersion.current) setError(e instanceof Error ? e.message : tx('查询失败', 'Search failed')); }
  };
  const submit = async () => {
    if (busyRef.current || !reason.trim() || (!reversing && (!selected || !target))) return;
    if (!reversing && !/^\d+(\.\d{1,2})?$/.test(amount)) { setError(tx('请输入有效美元金额', 'Enter a valid USD amount')); return; }
    const [whole, fraction = ''] = amount.split('.');
    const body = reversing ? { reason: reason.trim() } : { creditId: selected!.creditId, expectedRevision: selected!.revision,
      targetCustomerId: target!.customerId, targetBinding: target!.binding, amount: `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`, reason: reason.trim() };
    const path = reversing ? `/prepayment-transfers/${reversing.id}/reverse` : '/prepayment-transfers';
    const key = JSON.stringify({ path, body });
    if (intent.current?.key !== key) intent.current = { key, requestId: crypto.randomUUID() };
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await apiRequest(path, { method: 'POST', body: JSON.stringify({ ...body, requestId: intent.current.requestId }) });
      resetForm(); setMessage(tx('操作成功，原收据与收入记录未复制', 'Completed. The original receipt and income were not duplicated.'));
      await load(); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : tx('操作失败，请刷新后检查', 'Operation failed. Refresh to check the latest state.')); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const rows = (data?.credits || []).filter(row => `${row.customerLabel} ${row.sourceOrderNo} ${row.receiptNo || ''}`.toLowerCase().includes(filter.trim().toLowerCase()));

  return <Dialog open={open} onOpenChange={value => {
    if (busyRef.current) return;
    setOpen(value); resetForm(); setError(''); setMessage('');
    if (value) void load(true);
  }}>
    <Button size="sm" variant="outline" onClick={() => { setOpen(true); resetForm(); setError(''); setMessage(''); void load(true); }}><Wallet />{initialCreditId ? tx('转移', 'Transfer') : tx('转移与记录', 'Transfers & History')}</Button>
    <DialogContent className="w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{tx('预付款余额', 'Prepayment Credits')}</DialogTitle>
        <DialogDescription>{tx('余款单独保留，不重复生成收入。只有管理员可以明确转移或撤销未使用款项。',
          'Unused funds remain separate from invoice balances. Only administrators can transfer or reverse unused credit.')}</DialogDescription>
      </DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
      {selected || reversing ? <div className="flex min-w-0 flex-col gap-4">
        <div className="break-words font-medium">{selected ? `${selected.customerLabel} / ${selected.sourceOrderNo}` : `${tx('撤销转移', 'Reverse transfer')} ${formatUsdAmount(reversing!.amount)}`}</div>
        {selected && <>
          <p>{tx('可用余额', 'Available')}: {formatUsdAmount(selected.availableAmount)}</p>
          <form className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); void search(); }}>
            <Input aria-label={tx('搜索目标订单', 'Search target order')} className="min-w-0" value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setTarget(null); setTargets([]); searchVersion.current++; }} />
            <Button type="submit" variant="outline" disabled={busy || !query.trim()} aria-label={tx('搜索', 'Search')}><Search /></Button>
          </form>
          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
            {targets.map(row => <Button key={`${row.binding.type}:${row.binding.id}`} variant={target === row ? 'default' : 'outline'}
              className="h-auto justify-start whitespace-normal break-words text-left" disabled={busy} onClick={() => setTarget(row)}>
              {row.customerLabel} / {row.orderNo} / {row.invoiceNo || tx('尚未开票', 'Not invoiced')}
            </Button>)}
          </div>
          {target && <Alert><AlertDescription>{tx('将款项转到', 'Transfer to')}: {target.customerLabel} / {target.orderNo}</AlertDescription></Alert>}
          <div className="flex flex-col gap-2"><Label htmlFor="prepayment-amount">{tx('转移金额 (USD)', 'Transfer amount (USD)')}</Label><MoneyInput id="prepayment-amount" value={amount} onValueChange={setAmount} disabled={busy} /></div>
        </>}
        <div className="flex flex-col gap-2"><Label htmlFor="prepayment-reason">{tx('原因（必填，保留审计）', 'Reason (required, audited)')}</Label><Textarea id="prepayment-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} disabled={busy} /></div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={resetForm}>{tx('返回', 'Back')}</Button>
          <Button disabled={busy || !reason.trim() || (!reversing && (!target || !amount))} onClick={() => void submit()}>{busy && <Loader2 className="animate-spin" />}{reversing ? tx('确认撤销', 'Confirm reversal') : tx('确认转移', 'Confirm transfer')}</Button>
        </div>
      </div> : <div className="flex flex-col gap-3">
        <div className="flex gap-2"><Input aria-label={tx('筛选预付款', 'Filter credits')} value={filter} onChange={e => setFilter(e.target.value)} className="min-w-0" /><Button variant="outline" disabled={loading} onClick={() => void load()}>{tx('刷新', 'Refresh')}</Button></div>
        {loading && <p role="status">{tx('加载中', 'Loading')}</p>}
        {!loading && !rows.length && <p>{tx('没有可见的预付款记录', 'No visible prepayment credits')}</p>}
        <div className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
          {rows.map(row => <div key={row.creditId} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 break-words"><div className="font-medium">{row.customerLabel} / {row.sourceOrderNo || '-'}</div><div className="text-sm text-muted-foreground">{row.receiptNo || (row.transferred ? tx('转入款项', 'Transferred credit') : tx('已关联原收据', 'Linked original receipt'))}</div>
              <div className="flex flex-wrap gap-x-3 text-sm"><span>{tx('可用', 'Available')}: {formatUsdAmount(row.availableAmount)}</span><span>{tx('已使用', 'Used')}: {formatUsdAmount(row.usedAmount)}</span><span>{tx('已预留', 'Reserved')}: {formatUsdAmount(row.reservedAmount)}</span></div>
              {row.held && <p className="text-sm text-muted-foreground">{tx('删除审批中，暂不可用', 'On hold pending deletion approval')}</p>}
            </div>
            {data?.canTransfer && <Button size="sm" variant="outline" disabled={Number(row.availableAmount) <= 0 || loading} onClick={() => { setSelected(row); setError(''); setMessage(''); }}>{tx('转移', 'Transfer')}</Button>}
          </div>)}
        </div>
        {data?.canTransfer && data.transfers.length > 0 && <details><summary className="cursor-pointer">{tx('最近转移记录', 'Recent transfers')}</summary><div className="flex max-h-48 flex-col gap-2 overflow-y-auto py-2">{data.transfers.map(row => <div key={row.id} className="flex items-center justify-between gap-2 rounded-md border p-2"><span className="min-w-0 break-words text-sm">{formatUsdAmount(row.amount)} / {row.reason}</span><Button size="sm" variant="ghost" disabled={Boolean(row.reversedAt)} aria-label={tx('撤销转移', 'Reverse transfer')} onClick={() => { setReversing(row); setReason(''); setError(''); }}><Undo2 />{row.reversedAt ? tx('已撤销', 'Reversed') : tx('撤销', 'Reverse')}</Button></div>)}</div></details>}
      </div>}
    </DialogContent>
  </Dialog>;
}
