'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import type { SettingsAuditFilterState } from '../types';
import type { SettingsAuditViewModel } from '../view-model';

export type SettingsAuditCardProps = {
  tx: (zh: string, en: string) => string;
  canViewAudit: boolean;
  loading: boolean;
  loadingMore: boolean;
  exporting: boolean;
  exportHistoryLoading: boolean;
  exportHistoryLoadingMore: boolean;
  viewModel: SettingsAuditViewModel;
  onFilterChange: React.Dispatch<React.SetStateAction<SettingsAuditFilterState>>;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onExport: () => void;
  onRefreshExportHistory: () => void;
  onLoadMoreExportHistory: () => void;
};

export function SettingsAuditCard({
  tx,
  canViewAudit,
  loading,
  loadingMore,
  exporting,
  exportHistoryLoading,
  exportHistoryLoadingMore,
  viewModel,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  onRefresh,
  onLoadMore,
  onExport,
  onRefreshExportHistory,
  onLoadMoreExportHistory,
}: SettingsAuditCardProps) {
  const filterPanel = (
    <div className="grid grid-cols-1 gap-3 rounded-md border p-4 md:grid-cols-2 xl:grid-cols-6">
      <div className="space-y-1">
        <Label htmlFor="settings-audit-actor-filter">{tx('操作者', 'Actor')}</Label>
        <Input
          id="settings-audit-actor-filter"
          data-testid="settings-audit-actor-filter"
          value={viewModel.filters.actorQuery}
          placeholder={tx('邮箱 / 名称 / ID', 'Email / name / ID')}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, actorQuery: event.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-audit-key-filter">{tx('配置键', 'Setting Key')}</Label>
        <select
          id="settings-audit-key-filter"
          data-testid="settings-audit-key-filter"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={viewModel.filters.settingKey}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, settingKey: event.target.value }))}
        >
          <option value="">{tx('全部配置键', 'All Setting Keys')}</option>
          {viewModel.keyOptions.map((key) => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-audit-date-from">{tx('开始时间', 'Date From')}</Label>
        <Input
          id="settings-audit-date-from"
          data-testid="settings-audit-date-from"
          type="datetime-local"
          value={viewModel.filters.dateFrom}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, dateFrom: event.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-audit-date-to">{tx('结束时间', 'Date To')}</Label>
        <Input
          id="settings-audit-date-to"
          data-testid="settings-audit-date-to"
          type="datetime-local"
          value={viewModel.filters.dateTo}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, dateTo: event.target.value }))}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-audit-page-size">{tx('分页大小', 'Page Size')}</Label>
        <select
          id="settings-audit-page-size"
          data-testid="settings-audit-page-size"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={String(viewModel.filters.pageSize)}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, pageSize: Number(event.target.value) || 20 }))}
        >
          {viewModel.pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="settings-audit-export-limit">{tx('导出条数', 'Export Rows')}</Label>
        <select
          id="settings-audit-export-limit"
          data-testid="settings-audit-export-limit"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={String(viewModel.filters.exportLimit)}
          onChange={(event) => onFilterChange((prev) => ({ ...prev, exportLimit: Number(event.target.value) || Math.max(...viewModel.exportOptions, 1) }))}
        >
          {viewModel.exportOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500">
          {tx('服务端最多导出', 'Server export cap')}: {Math.max(...viewModel.exportOptions, 1)}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-6">
        <Button variant="outline" onClick={onApplyFilters} data-testid="settings-audit-apply-filters">
          {tx('应用筛选', 'Apply Filters')}
        </Button>
        <Button variant="ghost" onClick={onResetFilters} data-testid="settings-audit-reset-filters">
          {tx('重置筛选', 'Reset Filters')}
        </Button>
        <Button variant="outline" onClick={onExport} disabled={exporting} data-testid="settings-audit-export">
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
        {viewModel.exportHistorySummaryItems.map((item) => (
          <span key={item.id}>{item.label}: {item.value}</span>
        ))}
      </div>
      <div className="overflow-x-auto rounded-md border" data-testid="settings-audit-export-history-table">
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
            {exportHistoryLoading && viewModel.exportHistoryRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : viewModel.exportHistoryRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">
                  {viewModel.emptyHistoryMessage}
                </TableCell>
              </TableRow>
            ) : viewModel.exportHistoryRows.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-xs align-top">
                  {entry.createdAtLabel}
                </TableCell>
                <TableCell className="align-top">
                  <div className="text-sm font-medium">{entry.actorEmail}</div>
                  {entry.actorName ? <div className="text-xs text-gray-500">{entry.actorName}</div> : null}
                </TableCell>
                <TableCell className="align-top text-xs">
                  {entry.summaryItems.map((item) => (
                    <div key={`${entry.id}-${item.id}`}>{item.label}: {item.value}</div>
                  ))}
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
                  {entry.filterItems.map((item) => (
                    <div key={`${entry.id}-${item.id}`}>{item.label}: {item.value}</div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onLoadMoreExportHistory} disabled={!viewModel.exportHistoryHasMore || exportHistoryLoadingMore} data-testid="settings-audit-export-history-load-more">
          {exportHistoryLoadingMore ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {tx('加载更多历史', 'Load More History')}
        </Button>
      </div>
    </div>
  );

  return (
    <Card data-testid="settings-audit-card">
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
          <p className="text-sm text-gray-500">{viewModel.noAccessMessage}</p>
        ) : loading ? (
          <div className="py-8 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : viewModel.auditRows.length === 0 ? (
          <>
            {filterPanel}
            <p className="text-sm text-gray-500">{viewModel.emptyAuditMessage}</p>
            {exportHistoryPanel}
          </>
        ) : (
          <>
            {filterPanel}
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              {viewModel.auditSummaryItems.map((item) => (
                <span key={item.id}>{item.label}: {item.value}</span>
              ))}
            </div>
            <div className="overflow-x-auto rounded-md border" data-testid="settings-audit-log-table">
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
                  {viewModel.auditRows.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs align-top">
                        {entry.createdAtLabel}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="text-sm font-medium">{entry.actorEmail}</div>
                        {entry.actorName ? <div className="text-xs text-gray-500">{entry.actorName}</div> : null}
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
                            <div key={change.id} className="rounded border bg-gray-50 p-2 text-xs">
                              <div className="font-medium">{change.key}</div>
                              <div>{tx('变更前', 'Before')}: <span className="font-mono">{change.beforeValue}</span></div>
                              <div>{tx('变更后', 'After')}: <span className="font-mono">{change.afterValue}</span></div>
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
              <Button variant="outline" onClick={onLoadMore} disabled={!viewModel.auditHasMore || loadingMore} data-testid="settings-audit-load-more">
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
