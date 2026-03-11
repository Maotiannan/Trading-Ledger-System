'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw } from 'lucide-react';
import type { SettingsAuditEntry } from '../types';

export type SettingsAuditCardProps = {
  tx: (zh: string, en: string) => string;
  canViewAudit: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  entries: SettingsAuditEntry[];
  onRefresh: () => void;
  onLoadMore: () => void;
};

function displayAuditValue(value: string): string {
  return value || '-';
}

export function SettingsAuditCard({
  tx,
  canViewAudit,
  loading,
  loadingMore,
  hasMore,
  entries,
  onRefresh,
  onLoadMore,
}: SettingsAuditCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{tx('配置变更审计', 'Configuration Audit')}</CardTitle>
          <CardDescription>
            {tx('记录系统配置修改的操作人、时间与前后值。', 'Track who changed system settings, when, and the before/after values.')}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={!canViewAudit || loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {tx('刷新审计', 'Refresh Audit')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canViewAudit ? (
          <p className="text-sm text-gray-500">{tx('仅管理员可查看配置变更审计。', 'Only admins can view configuration audit logs.')}</p>
        ) : loading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500">{tx('暂无配置审计记录。', 'No configuration audit logs yet.')}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tx('时间', 'Time')}</TableHead>
                    <TableHead>{tx('操作人', 'Actor')}</TableHead>
                    <TableHead>{tx('更新键', 'Updated Keys')}</TableHead>
                    <TableHead>{tx('变更详情', 'Changes')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs align-top">
                        {new Date(entry.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="text-sm font-medium">{entry.actor?.email || '-'}</div>
                        {entry.actor?.name ? <div className="text-xs text-gray-500">{entry.actor.name}</div> : null}
                      </TableCell>
                      <TableCell className="align-top text-xs">
                        <div className="flex flex-wrap gap-1">
                          {entry.updatedKeys.map((key) => (
                            <span key={`${entry.id}-${key}`} className="rounded bg-gray-100 px-2 py-1 text-xs">
                              {key}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          {entry.changes.map((change) => (
                            <div key={`${entry.id}-${change.key}`} className="rounded border bg-gray-50 p-2 text-xs">
                              <div className="font-medium">{change.key}</div>
                              <div>{tx('变更前', 'Before')}: <span className="font-mono">{displayAuditValue(change.before)}</span></div>
                              <div>{tx('变更后', 'After')}: <span className="font-mono">{displayAuditValue(change.after)}</span></div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onLoadMore} disabled={!hasMore || loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {tx('加载更多', 'Load More')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
