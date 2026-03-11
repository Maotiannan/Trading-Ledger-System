'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RefreshCw } from 'lucide-react';
import type { SettingsAuditEntry, SettingsAuditFilterState } from '../types';

export type SettingsAuditCardProps = {
  tx: (zh: string, en: string) => string;
  canViewAudit: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  entries: SettingsAuditEntry[];
  filters: SettingsAuditFilterState;
  keyOptions: string[];
  onFilterChange: React.Dispatch<React.SetStateAction<SettingsAuditFilterState>>;
  onApplyFilters: () => void;
  onResetFilters: () => void;
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
  filters,
  keyOptions,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
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
          <>
            <div className="grid grid-cols-1 gap-3 rounded-md border p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1">
                <Label>{tx('操作者', 'Actor')}</Label>
                <Input
                  value={filters.actorQuery}
                  placeholder={tx('邮箱 / 名称 / ID', 'Email / name / ID')}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, actorQuery: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{tx('配置键', 'Setting Key')}</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={filters.settingKey}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, settingKey: event.target.value }))}
                >
                  <option value="">{tx('全部配置键', 'All Setting Keys')}</option>
                  {keyOptions.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{tx('开始时间', 'Date From')}</Label>
                <Input
                  type="datetime-local"
                  value={filters.dateFrom}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, dateFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{tx('结束时间', 'Date To')}</Label>
                <Input
                  type="datetime-local"
                  value={filters.dateTo}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, dateTo: event.target.value }))}
                />
              </div>
              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
                <Button variant="outline" onClick={onApplyFilters}>
                  {tx('应用筛选', 'Apply Filters')}
                </Button>
                <Button variant="ghost" onClick={onResetFilters}>
                  {tx('重置筛选', 'Reset Filters')}
                </Button>
              </div>
            </div>
            <p className="text-sm text-gray-500">{tx('暂无配置审计记录。', 'No configuration audit logs yet.')}</p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 rounded-md border p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1">
                <Label>{tx('操作者', 'Actor')}</Label>
                <Input
                  value={filters.actorQuery}
                  placeholder={tx('邮箱 / 名称 / ID', 'Email / name / ID')}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, actorQuery: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{tx('配置键', 'Setting Key')}</Label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={filters.settingKey}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, settingKey: event.target.value }))}
                >
                  <option value="">{tx('全部配置键', 'All Setting Keys')}</option>
                  {keyOptions.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{tx('开始时间', 'Date From')}</Label>
                <Input
                  type="datetime-local"
                  value={filters.dateFrom}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, dateFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{tx('结束时间', 'Date To')}</Label>
                <Input
                  type="datetime-local"
                  value={filters.dateTo}
                  onChange={(event) => onFilterChange((prev) => ({ ...prev, dateTo: event.target.value }))}
                />
              </div>
              <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
                <Button variant="outline" onClick={onApplyFilters}>
                  {tx('应用筛选', 'Apply Filters')}
                </Button>
                <Button variant="ghost" onClick={onResetFilters}>
                  {tx('重置筛选', 'Reset Filters')}
                </Button>
              </div>
            </div>
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
