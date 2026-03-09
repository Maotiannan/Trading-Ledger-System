'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUiText } from '@/components/workspace/shared';
import type { ImportResultRowBase } from '@/components/workspace/hooks/use-import-result-table';

export type ImportResultDialogColumn<T extends ImportResultRowBase> = {
  key: string;
  header: string;
  className?: string;
  renderCell: (row: T, canEdit: boolean, rowIndex: number) => React.ReactNode;
};

type ImportResultDialogProps<T extends ImportResultRowBase> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  filter: 'failed' | 'all';
  onFilterChange: (value: 'failed' | 'all') => void;
  rows: T[];
  columns: ImportResultDialogColumn<T>[];
  attemptCount: number;
  page: number;
  totalPages: number;
  onPageChange: (updater: (page: number) => number) => void;
  onClose: () => void;
  onRetry: () => void;
  retrying: boolean;
  retryDisabled: boolean;
};

export function ImportResultDialog<T extends ImportResultRowBase>({
  open,
  onOpenChange,
  title,
  description,
  filter,
  onFilterChange,
  rows,
  columns,
  attemptCount,
  page,
  totalPages,
  onPageChange,
  onClose,
  onRetry,
  retrying,
  retryDisabled,
}: ImportResultDialogProps<T>) {
  const tx = useUiText();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!top-[5px] !left-[5px] !translate-x-0 !translate-y-0 !w-[calc(100vw-10px)] !max-w-none !h-[calc(100vh-10px)] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="whitespace-pre-wrap break-words">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="text-gray-600">
            {tx('默认仅看最新失败行，可切换查看全部。', 'Default view shows latest failed rows. Switch to view all rows.')}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 border rounded-md px-2 bg-white"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value === 'all' ? 'all' : 'failed')}
            >
              <option value="failed">{tx('仅看失败', 'Failed Only')}</option>
              <option value="all">{tx('查看全部', 'All Rows')}</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-auto border rounded-md">
          <Table className="min-w-max table-auto">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                {columns.map((column) => (
                  <TableHead key={column.key} className={column.className}>{column.header}</TableHead>
                ))}
                <TableHead className="min-w-[180px]">{tx('最新状态', 'Latest Status')}</TableHead>
                <TableHead className="min-w-[540px]">{tx('最新原因', 'Latest Reason')}</TableHead>
                {Array.from({ length: attemptCount }).map((_, idx) => (
                  <TableHead key={`attempt-${idx}`} className="min-w-[140px]">{`Result#${idx + 1}`}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => {
                const canEdit = row.latestStatus === 'FAILED';
                return (
                  <TableRow key={`${row.rowNo}-${index}`}>
                    <TableCell>{row.rowNo || index + 1}</TableCell>
                    {columns.map((column) => (
                      <TableCell key={`${column.key}-${row.rowNo}`}>{column.renderCell(row, canEdit, index)}</TableCell>
                    ))}
                    <TableCell className={row.latestStatus === 'FAILED' ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                      {row.latestStatus}
                    </TableCell>
                    <TableCell className="min-w-[540px] whitespace-pre-wrap break-words text-xs">
                      {row.latestReason || '-'}
                    </TableCell>
                    {Array.from({ length: attemptCount }).map((_, idx) => (
                      <TableCell key={`attempt-value-${row.rowNo}-${idx}`} className="text-xs">
                        {row.attempts[idx]?.status || '-'}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3 + columns.length + attemptCount} className="text-center text-gray-500">
                    {filter === 'failed'
                      ? tx('当前没有最新失败行，可切换“查看全部”', 'No latest failed rows. Switch to "All Rows".')
                      : tx('暂无导入结果', 'No import results')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="text-gray-600">
            {tx('每页 50 行', '50 rows per page')} · {tx('第', 'Page')} {page} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onPageChange((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              {tx('上一页', 'Prev')}
            </Button>
            <Button variant="outline" onClick={() => onPageChange((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              {tx('下一页', 'Next')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tx('关闭', 'Close')}</Button>
          <Button onClick={onRetry} disabled={retrying || retryDisabled}>
            {retrying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {tx('仅重试失败行', 'Retry Failed Rows')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
