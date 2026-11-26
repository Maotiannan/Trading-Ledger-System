'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiCall, getApiErrorMessage } from '@/components/workspace/shared';
import { formatAppDate } from '@/lib/app-time';

type Entry = { id: string; kind: string; resourceId: string; deletedAt: string; recoverableUntil: string; lastError: string | null };

export function RecoverySettingsCard({ tx, config, saving, onFieldChange, onSave }: {
  tx: (zh: string, en: string) => string;
  config: Record<string, string>;
  saving: boolean;
  onFieldChange: (key: string, value: string) => void;
  onSave: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await apiCall('recovery');
      if (!result.success) throw result;
      setEntries(result.data);
      setLoaded(true);
    } catch (error) { setError(getApiErrorMessage(error, tx('恢复区读取失败', 'Unable to load recovery records'))); }
    finally { setBusy(false); }
  }
  async function restore(id: string) {
    if (!window.confirm(tx('恢复原记录及关联？不会覆盖现有业务，冲突时将停止。', 'Restore the original record and links? Existing data will not be overwritten; conflicts stop the restore.'))) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiCall('recovery', { method: 'POST', body: JSON.stringify({ id }) });
      if (!result.success) throw result;
      await load();
    } catch (error) { setError(getApiErrorMessage(error, tx('恢复失败', 'Restore failed'))); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{tx('仅保留自动清理的过期待签名收据和未绑定暂存附件。到期后不可恢复。', 'Only expired signing drafts and unattached staged uploads are retained. Expired entries cannot be restored.')}</p>
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="recovery-retention">{tx('恢复期限（1–15天）', 'Recovery retention (1–15 days)')}</Label>
        <Input id="recovery-retention" type="number" min={1} max={15} className="w-28" value={config.RECOVERY_RETENTION_DAYS || '15'} onChange={(e) => onFieldChange('RECOVERY_RETENTION_DAYS', e.target.value)} />
      </div>
      <Button disabled={saving} onClick={onSave}>{tx('保存设置', 'Save settings')}</Button>
      <Button variant="outline" disabled={busy} onClick={() => { void load(); }}>{tx('刷新恢复区', 'Refresh recovery area')}</Button>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loaded && <Table>
      <TableHeader><TableRow>
        <TableHead>{tx('类型 / 原记录', 'Type / Original record')}</TableHead>
        <TableHead>{tx('清理日期', 'Deleted')}</TableHead><TableHead>{tx('恢复截止', 'Restore before')}</TableHead><TableHead>{tx('操作', 'Actions')}</TableHead>
      </TableRow></TableHeader>
      <TableBody>{entries.map((entry) => <TableRow key={entry.id}>
        <TableCell className="max-w-64 break-all">{entry.kind === 'STAGED_ASSET' ? tx('暂存附件', 'Staged upload') : tx('待签名收据', 'Signing draft')}<div className="text-xs text-muted-foreground">{entry.resourceId}</div></TableCell>
        <TableCell className="whitespace-nowrap">{formatAppDate(entry.deletedAt)}</TableCell><TableCell className="whitespace-nowrap">{formatAppDate(entry.recoverableUntil)}</TableCell>
        <TableCell><Button size="sm" variant="outline" disabled={busy} onClick={() => { void restore(entry.id); }}>{tx('恢复', 'Restore')}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table>}
    {loaded && !entries.length && <p className="text-sm text-muted-foreground">{tx('暂无可恢复记录', 'No recoverable records')}</p>}
  </div>;
}
