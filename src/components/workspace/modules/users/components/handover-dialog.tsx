'use client';

import { useState } from 'react';
import type { User } from '@/lib/store';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const rank = { USER: 1, SALES: 2, ADMIN: 3 };

export function HandoverDialog({ source, users, tx, onClose, onSuccess }: {
  source: User; users: User[]; tx: (zh: string, en: string) => string; onClose: () => void; onSuccess: () => Promise<void>;
}) {
  const [recipientId, setRecipientId] = useState('');
  const [preview, setPreview] = useState<{ fingerprint: string; counts: Record<string, number>; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recipients = users.filter((row) => row.id !== source.id && !row.disabledAt && rank[row.role] >= rank[source.role]);
  const labels: Record<string, string> = { invoice: tx('账单', 'Invoices'), order: tx('财务订单', 'Finance orders'), receipt: tx('收据', 'Receipts'),
    detail: tx('付款明细', 'Payment details'), swift: 'SWIFT', orderTracker: tx('业务订单', 'Orders'), paymentAgent: tx('付款代理', 'Payment agents'),
    uploadedAsset: tx('附件', 'Uploads'), customer: tx('客户', 'Customers') };
  async function submit(confirm: boolean) {
    setBusy(true); setError('');
    try {
      const result = await apiCall('auth', { method: 'POST', body: JSON.stringify({ action: confirm ? 'handover-confirm' : 'handover-preview', userId: source.id,
        recipientId, ...(confirm && preview ? { fingerprint: preview.fingerprint, requestId: preview.requestId } : {}) }) });
      if (!result.success) throw result;
      if (confirm) { await onSuccess(); onClose(); }
      else setPreview({ ...result.data, requestId: crypto.randomUUID() });
    } catch (error) { setError(getApiErrorMessage(error, tx('交接失败，请重新预览后重试', 'Handover failed. Preview again before retrying.'))); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{tx('业务交接', 'Business Handover')}</DialogTitle>
        <DialogDescription>{tx('只交接当前管理权；不修改创建人、历史记录或上下级，也不会自动停用账号。', 'Transfers current custody only. Authors, history and hierarchy stay unchanged. The source account is not automatically disabled.')}</DialogDescription>
      </DialogHeader>
      <p className="break-all text-sm">{source.email}</p>
      <Label htmlFor="handover-recipient">{tx('接收账号', 'Recipient account')}</Label>
      <select id="handover-recipient" className="w-full rounded-md border px-3 py-2 text-sm" disabled={busy} value={recipientId} onChange={(e) => { setRecipientId(e.target.value); setPreview(null); setError(''); }}>
        <option value="">{tx('请选择', 'Select an account')}</option>
        {recipients.map((row) => <option key={row.id} value={row.id}>{row.email} ({row.role})</option>)}
      </select>
      {preview && <dl className="grid grid-cols-2 gap-2 text-sm">{Object.entries(preview.counts).map(([model, count]) => <div key={model} className="flex justify-between gap-2"><dt>{labels[model] || model}</dt><dd>{count}</dd></div>)}</dl>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter className="flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>{tx('取消', 'Cancel')}</Button>
        <Button variant="outline" disabled={busy || !recipientId} onClick={() => { void submit(false); }}>{tx('预览范围', 'Preview scope')}</Button>
        <Button disabled={busy || !preview} onClick={() => { void submit(true); }}>{tx('确认交接', 'Confirm handover')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
