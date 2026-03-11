'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import type {
  SettingsAuditEntry,
  SettingsAuditExportEntry,
  SettingsAuditFilterState,
  SettingsAuditMeta,
} from '../types';

export type SettingsAuditCardProps = {
  tx: (zh: string, en: string) => string;
  canViewAudit: boolean;
  loading: boolean;
  loadingMore: boolean;
  exporting: boolean;
  hasMore: boolean;
  entries: SettingsAuditEntry[];
  exportHistoryEntries: SettingsAuditExportEntry[];
  exportHistoryLoading: boolean;
  exportHistoryLoadingMore: boolean;
  exportHistoryHasMore: boolean;
  filters: SettingsAuditFilterState;
  meta: SettingsAuditMeta;
  keyOptions: string[];
  onFilterChange: React.Dispatch<React.SetStateAction<SettingsAuditFilterState>>;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onExport: () => void;
  onRefreshExportHistory: () => void;
  onLoadMoreExportHistory: () => void;
};

function displayAuditValue(value: string): string {
  return value || '-';
}

export function SettingsAuditCard({
  tx,
  canViewAudit,
  loading,
  loadingMore,
  exporting,
  hasMore,
  entries,
  exportHistoryEntries,
  exportHistoryLoading,
  exportHistoryLoadingMore,
  exportHistoryHasMore,
  filters,
  meta,
  keyOptions,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  onRefresh,
  onLoadMore,
  onExport,
  onRefreshExportHistory,
  onLoadMoreExportHistory,
}: SettingsAuditCardProps) {
  const exportOptions = Array.from(new Set([500, 1000, 2000, 5000, meta.maxExportRows]))
    .filter((value) => value <= meta.maxExportRows)
    .sort((a, b) => a - b);
  const filterPanel = (
    <div className="grid grid-cols-1 gap-3 rounded-md border p-4 md:grid-cols-2 xl:grid-cols-6">
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
      <div className="space-y-1">
        <Label>{tx('分页大小', 'Page Size')}</Label>
        <select
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={String(filters.pageSize)}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, pageSize: Number(event.target.value) || 20 }))}
        >
          {meta.pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>{tx('导出条数', 'Export Rows')}</Label>
        <select
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={String(filters.exportLimit)}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, exportLimit: Number(event.target.value) || meta.maxExportRows }))}
        >
          {exportOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500">
          {tx('服务端最多导出', 'Server export cap')}: {meta.maxExportRows}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-6">
        <Button variant="outline" onClick={onApplyFilters}>
          {tx('应用筛选', 'Apply Filters')}
        </Button>
        <Button variant="ghost" onClick={onResetFilters}>
          {tx('重置筛选', 'Reset Filters')}
        </Button>
        <Button variant="outline" onClick={onExport} disabled={exporting}>
          {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {tx('导出CSV', 'Export CSV')}
        </Button>
      </div>
    </div>
  );

  const exportHistoryPanel = (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{tx('导出历史', 'Export History')}</div>
          <div className="text-xs text-gray-500">
            {tx('记录配置审计 CSV 导出的操作者、筛选条件和导出结果。', 'Track who exported configuration audit CSV files, which filters were used, and whether the export was truncated.')}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRefreshExportHistory} disabled={exportHistoryLoading}>
          {exportHistoryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {tx('刷新历史', 'Refresh History')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{tx('当前已加载', 'Loaded')}: {exportHistoryEntries.length}</span>
        <span>{exportHistoryHasMore ? tx('还有更多历史记录可加载', 'More history entries available') : tx('历史记录已加载到末尾', 'Reached the end of history')}</span>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tx('时间', 'Time')}</TableHead>
              <TableHead>{tx('导出人', 'Exporter')}</TableHead>
              <TableHead>{tx('导出摘要', 'Summary')}</TableHead>
              <TableHead>{tx('筛选条件', 'Filters')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exportHistoryLoading && exportHistoryEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : exportHistoryEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">
                  {tx('暂无导出历史。', 'No export history yet.')}
                </TableCell>
              </TableRow>
            ) : exportHistoryEntries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-xs align-top">
                  {new Date(entry.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="align-top">
                  <div className="text-sm font-medium">{entry.actor?.email || '-'}</div>
                  {entry.actor?.name ? <div className="text-xs text-gray-500">{entry.actor.name}</div> : null}
                </TableCell>
                <TableCell className="align-top text-xs">
                  <div>{tx('导出条数', 'Rows')}: {entry.rowCount}</div>
                  <div>{tx('请求上限', 'Requested limit')}: {entry.exportLimit}</div>
                  <div>{tx('服务端上限', 'Server cap')}: {entry.maxExportRows}</div>
                  <div>{tx('结果状态', 'Result')}: {entry.truncated ? tx('已截断', 'Truncated') : tx('完整导出', 'Complete')}</div>
                  {entry.exportedKeys.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.exportedKeys.map((key) => (
                        <span key={`${entry.id}-${key}`} className="rounded bg-gray-100 px-2 py-1 text-[11px]">
                          {key}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="align-top text-xs">
                  <div>{tx('操作者筛选', 'Actor filter')}: {entry.filterActor || '-'}</div>
                  <div>{tx('配置键筛选', 'Setting key filter')}: {entry.filterKey || '-'}</div>
                  <div>{tx('开始时间', 'Date From')}: {entry.filterDateFrom || '-'}</div>
                  <div>{tx('结束时间', 'Date To')}: {entry.filterDateTo || '-'}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onLoadMoreExportHistory} disabled={!exportHistoryHasMore || exportHistoryLoadingMore}>
          {exportHistoryLoadingMore ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {tx('加载更多历史', 'Load More History')}
        </Button>
      </div>
    </div>
  );

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
            {filterPanel}
            <p className="text-sm text-gray-500">{tx('暂无配置审计记录。', 'No configuration audit logs yet.')}</p>
            {exportHistoryPanel}
          </>
        ) : (
          <>
            {filterPanel}
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{tx('当前已加载', 'Loaded')}: {entries.length}</span>
              <span>{tx('分页大小', 'Page Size')}: {filters.pageSize}</span>
              <span>{tx('分页模式', 'Pagination')}: {tx('游标', 'Cursor')} ({meta.cursorMode})</span>
              <span>{hasMore ? tx('还有更多记录可加载', 'More entries available') : tx('已加载到末尾', 'Reached the end')}</span>
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
            {exportHistoryPanel}
          </>
        )}
      </CardContent>
    </Card>
  );
}
