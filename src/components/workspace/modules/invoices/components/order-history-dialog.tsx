'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import {
  ReceiptImagePreviewDialog,
  type ReceiptImagePreviewInfo,
} from '@/components/workspace/modules/receipts/components/receipt-image-preview-dialog';
import { getDisplayImageUrl } from '@/components/workspace/api/client';
import { formatAppDateTime } from '@/lib/app-time';
import { formatUsdAmount } from '@/lib/display-format';
import { useState } from 'react';

export type OrderHistoryDialogProps = {
  open: boolean;
  title: string;
  rows: Array<Record<string, unknown>>;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
  pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number };
  pageSizeOptions?: readonly number[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
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
  failed = false,
  onRetry,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  onOpenReceiptImage,
}: OrderHistoryDialogProps) {
  const [receiptImage, setReceiptImage] = useState<ReceiptImagePreviewInfo | null>(null);

  const openReceiptImage = (row: Record<string, unknown>) => {
    if (onOpenReceiptImage) {
      onOpenReceiptImage(row);
      return;
    }
    if (!row.imageUrl) return;
    setReceiptImage({
      url: getDisplayImageUrl(String(row.imageUrl)),
      alt: tx('收据图片', 'Receipt image'),
      orderNo: String(row.orderNo || title || '-'),
      invNo: String(row.invNo || '-'),
      creator: String(row.payer || '-'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-4 sm:w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)] sm:p-6 xl:max-w-7xl">
        <DialogHeader>
          <DialogTitle>{tx('ORDER 付款记录', 'ORDER Payment Records')}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto rounded-md border">
          <Table className="min-w-[46rem] table-auto">
            <TableHeader>
              <TableRow>
                <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
                <TableHead>{tx('付款人', 'Payer')}</TableHead>
                <TableHead>{tx('本票付款', 'Applied to This Order')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
                <TableHead>{tx('日期', 'Date')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.id)}>
                  <TableCell>
                    {row.imageUrl ? (
                      <button
                        type="button"
                        className="text-blue-700 underline-offset-2 hover:underline"
                        onClick={() => openReceiptImage(row)}
                      >
                        {(row.receiptNo as string) || '-'}
                      </button>
                    ) : row.sourceRestricted ? tx('转入款项', 'Transferred payment') : (row.receiptNo as string) || '-'}
                  </TableCell>
                  <TableCell>{(row.payer as string) || '-'}</TableCell>
                  <TableCell>
                    <div>{formatUsdAmount(row.appliedToOrderAmount ?? row.usd)}</div>
                    {row.originalReceiptAmount != null && Number(row.originalReceiptAmount) !== Number(row.appliedToOrderAmount ?? row.usd) && (
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {tx('原收据', 'Original receipt')}: {formatUsdAmount(row.originalReceiptAmount)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell><Badge>{String(row.status || '-')}</Badge></TableCell>
                  <TableCell>{row.date ? new Date(String(row.date)).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{formatAppDateTime(String(row.createdAt || ''))}</TableCell>
                </TableRow>
              ))}
              {failed && (
                <TableRow><TableCell colSpan={6} className="text-center">
                  <span role="alert">{tx('付款记录加载失败，不能确定是否有付款。', 'Payment records could not be loaded.')}</span>
                  <Button variant="outline" size="sm" className="ml-2" onClick={onRetry}>{tx('重试', 'Retry')}</Button>
                </TableCell></TableRow>
              )}
              {rows.length === 0 && loading && <TableRow><TableCell colSpan={6} className="text-center" role="status">
                {tx('正在加载付款记录…', 'Loading payment records…')}
              </TableCell></TableRow>}
              {rows.length === 0 && !loading && !failed && (
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
      <ReceiptImagePreviewDialog
        image={receiptImage}
        tx={tx}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setReceiptImage(null);
        }}
      />
    </Dialog>
  );
}
