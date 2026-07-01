'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAppDateTime } from '@/lib/app-time';
import { KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { ExcelApiTokenSummary } from '../types';

export type ExcelTokenCardProps = {
  tokens: ExcelApiTokenSummary[];
  oneTimeToken: string | null;
  loading: boolean;
  saving: boolean;
  message: string | null;
  error: string | null;
  tx: (zh: string, en: string) => string;
  onRefresh: () => void;
  onGenerate: () => void;
  onRevoke: (tokenId: string) => void;
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatAppDateTime(date);
}

function activeToken(tokens: ExcelApiTokenSummary[]): ExcelApiTokenSummary | null {
  return tokens.find((token) => !token.revokedAt) || null;
}

export function ExcelTokenCard({
  tokens,
  oneTimeToken,
  loading,
  saving,
  message,
  error,
  tx,
  onRefresh,
  onGenerate,
  onRevoke,
}: ExcelTokenCardProps) {
  const active = activeToken(tokens);

  return (
    <Card data-testid="excel-token-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {tx('Excel ML 令牌', 'Excel ML Token')}
        </CardTitle>
        <CardDescription>
          {tx('令牌按当前账号独立生成，查询结果沿用该账号的现有可见范围。', 'Tokens are generated per account and lookups use that account scope.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onRefresh} disabled={loading || saving}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            {tx('刷新', 'Refresh')}
          </Button>
          <Button type="button" onClick={onGenerate} disabled={loading || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {active ? tx('重新生成', 'Rotate') : tx('生成令牌', 'Generate Token')}
          </Button>
          {active && (
            <Button type="button" variant="destructive" onClick={() => onRevoke(active.id)} disabled={loading || saving}>
              <Trash2 className="h-4 w-4 mr-2" />
              {tx('撤销当前令牌', 'Revoke Current')}
            </Button>
          )}
        </div>

        {oneTimeToken && (
          <div className="space-y-2">
            <Label>{tx('本次生成的令牌', 'Generated Token')}</Label>
            <Input readOnly className="font-mono text-xs" value={oneTimeToken} aria-label="Generated Excel token" />
            <p className="text-xs text-amber-700">
              {tx('完整令牌仅显示一次，刷新页面后只保留前缀。', 'The full token is shown once; after refresh only the prefix remains.')}
            </p>
          </div>
        )}

        {message && <p className="text-sm text-green-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border p-3">
            <div className="text-xs text-gray-500">{tx('当前状态', 'Current Status')}</div>
            <div className="mt-1 font-medium">{active ? tx('已启用', 'Active') : tx('未生成', 'Not generated')}</div>
            <div className="mt-2 text-xs text-gray-500">{tx('前缀', 'Prefix')}</div>
            <div className="font-mono">{active?.tokenPrefix || '-'}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-gray-500">{tx('最近使用', 'Last Used')}</div>
            <div className="mt-1">{formatDate(active?.lastUsedAt)}</div>
            <div className="mt-2 text-xs text-gray-500">{tx('创建时间', 'Created')}</div>
            <div>{formatDate(active?.createdAt)}</div>
          </div>
        </div>

        <div className="rounded-md border p-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 font-mono text-xs">
            <span>=ML(A1,1) ORDER NAME</span>
            <span>=ML(A1,2) COMPANY/CUSTOMER</span>
            <span>=ML(A1,3) MARK</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
