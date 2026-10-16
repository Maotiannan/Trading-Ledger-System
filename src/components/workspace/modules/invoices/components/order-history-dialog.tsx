'use client';

import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import { formatAppDateTime } from '@/lib/app-time';
import { formatUsdAmount } from '@/lib/display-format';

export type OrderHistoryDialogProps = {
  open: boolean;
  title: string;
  rows: Array<Record<string, unknown>>;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number };
  pageSizeOptions?: readonly number[];
  loading?: boolean;
  onPreviousPage?: () => void;
  onNextPage?: () => void;
  onPageSizeChange?: (pageSize: number) => void;
  onOpenReceiptImage?: (row: Record<string, unknown>) => void;
};

export function OrderHistoryDialog({
  open,
  title,
  rows,
  tx,
  onOpenChange,
  pagination,
  pageSizeOptions = [5, 10, 20, 50],
  loading = false,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  onOpenReceiptImage,
}: OrderHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tx('ORDER 付款记录', 'ORDER Payment Records')}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-auto">
          <Table className="min-w-[36rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
                <TableHead>{tx('付款人', 'Payer')}</TableHead>
                <TableHead>{tx('金额', 'Amount')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
                <TableHead>{tx('日期', 'Date')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.id)}>
                  <TableCell>
                    {row.imageUrl && onOpenReceiptImage ? (
                      <button
                        type="button"
                        className="text-blue-700 underline-offset-2 hover:underline"
                        onClick={() => onOpenReceiptImage(row)}
                      >
                        {(row.receiptNo as string) || '-'}
                      </button>
                    ) : (row.receiptNo as string) || '-'}
                  </TableCell>
                  <TableCell>{(row.payer as string) || '-'}</TableCell>
                  <TableCell>{formatUsdAmount(row.usd)}</TableCell>
                  <TableCell><Badge>{String(row.status || '-')}</Badge></TableCell>
                  <TableCell>{row.date ? new Date(String(row.date)).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{formatAppDateTime(String(row.createdAt || ''))}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-500">{tx('暂无付款记录', 'No payment records')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {pagination && onPreviousPage && onNextPage && onPageSizeChange ? (
          <ListPagination
            idPrefix="order-payment-records"
            tx={tx}
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalCount={pagination.totalItems}
            pageSize={pagination.pageSize}
            pageSizeOptions={pageSizeOptions}
            compact
            disabled={loading}
            onPreviousPage={onPreviousPage}
            onNextPage={onNextPage}
            onPageSizeChange={onPageSizeChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
