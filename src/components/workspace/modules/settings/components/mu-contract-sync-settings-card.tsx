'use client';

import { AlertTriangle, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatAppDateTime } from '@/lib/app-time';
import type {
  MuContractReconcilePreview,
  MuContractSyncAction,
  MuContractSyncStatus,
} from '../types';

type Props = {
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  action: MuContractSyncAction;
  config: Record<string, string>;
  status: MuContractSyncStatus | null;
  preview: MuContractReconcilePreview | null;
  tx: (zh: string, en: string) => string;
  onFieldChange: (key: string, value: string) => void;
  onSave: () => void;
  onRefresh: () => void;
  onSyncNow: () => void;
  onPreviewReconcile: () => void;
  onApplyReconcile: () => void;
};

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-center">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MuContractSyncSettingsCard({
  loading,
  saving,
  canEdit,
  action,
  config,
  status,
  preview,
  tx,
  onFieldChange,
  onSave,
  onRefresh,
  onSyncNow,
  onPreviewReconcile,
  onApplyReconcile,
}: Props) {
  const busy = loading || saving || action !== null;
  const initialReconcileCompleted = Boolean(status?.initialReconcileCompletedAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{tx('MU Contract 订单同步', 'MU Contract Order Sync')}</CardTitle>
            <CardDescription>
              {tx(
                '只同步 Orders 页面来源信息，不修改发票、收据、付款明细、SWIFT 或余额。',
                'Synchronizes Orders source metadata only. Invoices, receipts, payment details, SWIFT, and balances are never changed.',
              )}
            </CardDescription>
          </div>
          <Badge variant={status?.running ? 'secondary' : status?.enabled ? 'default' : 'outline'}>
            {status?.running
              ? tx('运行中', 'Running')
              : status?.enabled
                ? tx('已启用', 'Enabled')
                : tx('未启用', 'Disabled')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_180px_150px] md:items-end">
          <div className="flex items-center justify-between gap-4 md:self-center">
            <div>
              <Label htmlFor="mu-contract-sync-enabled">{tx('启用', 'Enabled')}</Label>
              <p className="text-xs text-muted-foreground">
                {tx('首次 Full Reconcile 完成后才能启用。', 'Available only after the first Full Reconcile.')}
              </p>
            </div>
            <Switch
              id="mu-contract-sync-enabled"
              aria-label={tx('启用', 'Enabled')}
              checked={config.MU_CONTRACT_SYNC_ENABLED === 'true'}
              disabled={!canEdit || busy}
              onCheckedChange={(checked) => onFieldChange('MU_CONTRACT_SYNC_ENABLED', String(checked))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mu-contract-sync-interval">{tx('轮询间隔（秒）', 'Polling interval (seconds)')}</Label>
            <Input
              id="mu-contract-sync-interval"
              aria-label={tx('轮询间隔（秒）', 'Polling interval (seconds)')}
              type="number"
              min={10}
              max={3600}
              value={config.MU_CONTRACT_SYNC_INTERVAL_SECONDS || '30'}
              disabled={!canEdit || busy}
              onChange={(event) => onFieldChange('MU_CONTRACT_SYNC_INTERVAL_SECONDS', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mu-contract-sync-batch">{tx('批量大小', 'Batch size')}</Label>
            <Input
              id="mu-contract-sync-batch"
              aria-label={tx('批量大小', 'Batch size')}
              type="number"
              min={1}
              max={500}
              value={config.MU_CONTRACT_SYNC_BATCH_SIZE || '100'}
              disabled={!canEdit || busy}
              onChange={(event) => onFieldChange('MU_CONTRACT_SYNC_BATCH_SIZE', event.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!canEdit || busy}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {tx('保存同步设置', 'Save Sync Settings')}
          </Button>
        </div>

        <div className="grid gap-3 rounded-xl bg-muted/45 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1 text-sm">
            <div className="font-medium">{tx('初始化状态', 'Initialization')}</div>
            <div className={initialReconcileCompleted ? 'text-emerald-700' : 'text-amber-700'}>
              {initialReconcileCompleted
                ? tx('Full Reconcile 已完成', 'Full Reconcile completed')
                : tx('需要首次 Full Reconcile', 'Initial reconcile required')}
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <div>{tx('已提交游标', 'Committed cursor')}: {status?.committedCursor || '-'}</div>
            <div>{tx('最近成功', 'Last success')}: {formatAppDateTime(status?.lastSuccessAt)}</div>
          </div>
          <div className="space-y-1 text-sm">
            <div>{tx('未匹配', 'Unmatched')}: {status?.unmatchedCount ?? 0}</div>
            <div>{tx('待处理冲突', 'Open conflicts')}: {status?.conflictCount ?? 0}</div>
          </div>
          {status?.lastError && (
            <div className="flex items-center gap-2 text-sm text-destructive sm:col-span-2 lg:col-span-3">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {tx('最近同步失败，请查看服务日志。', 'The latest synchronization failed. Check the service log.')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {tx('刷新状态', 'Refresh Status')}
          </Button>
          <Button variant="outline" onClick={onSyncNow} disabled={!canEdit || busy || !initialReconcileCompleted}>
            {action === 'sync-now' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tx('立即同步', 'Sync Now')}
          </Button>
          <Button variant="outline" onClick={onPreviewReconcile} disabled={!canEdit || busy}>
            {action === 'preview-reconcile' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tx('完整对账', 'Full Reconcile')}
          </Button>
          <Button onClick={onApplyReconcile} disabled={!canEdit || busy || !preview}>
            {action === 'apply-reconcile'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <ShieldCheck className="mr-2 h-4 w-4" />}
            {tx('执行对账', 'Apply Reconcile')}
          </Button>
        </div>

        {preview && (
          <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
            <div>
              <div className="font-medium text-blue-950">{tx('Full Reconcile 预览', 'Full Reconcile Preview')}</div>
              <div className="text-xs text-blue-800">
                {tx('确认以下数量后再执行；源数据变化时必须重新预览。', 'Review these counts before apply. A source change requires a new preview.')}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <CountTile label={tx('来源总数', 'Source rows')} value={preview.summary.totalSourceRows} />
              <CountTile label={tx('仅挂接', 'Metadata only')} value={preview.summary.metadataOnly} />
              <CountTile label={tx('新建', 'Creates')} value={preview.summary.creates} />
              <CountTile label={tx('更新', 'Updates')} value={preview.summary.updates} />
              <CountTile label={tx('冲突', 'Conflicts')} value={preview.summary.conflicts} />
              <CountTile label={tx('手工保留', 'Manual untouched')} value={preview.summary.manualOnlyUntouched} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
