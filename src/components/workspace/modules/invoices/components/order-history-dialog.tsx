'use client';

import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatUsdAmount } from '@/lib/display-format';

export type OrderHistoryDialogProps = {
  open: boolean;
  title: string;
  rows: Array<Record<string, unknown>>;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
};

export function OrderHistoryDialog({ open, title, rows, tx, onOpenChange }: OrderHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tx('ORDER 付款记录', 'ORDER Payment Records')}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx('收据号', 'Receipt No.')}</TableHead>
                <TableHead>{tx('金额', 'Amount')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
                <TableHead>{tx('日期', 'Date')}</TableHead>
                <TableHead>{tx('创建时间', 'Created At')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={String(row.id)}>
                  <TableCell>{(row.receiptNo as string) || '-'}</TableCell>
                  <TableCell>{formatUsdAmount(row.usd)}</TableCell>
                  <TableCell><Badge>{String(row.status || '-')}</Badge></TableCell>
                  <TableCell>{row.date ? new Date(String(row.date)).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{row.createdAt ? new Date(String(row.createdAt)).toLocaleString() : '-'}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-500">{tx('暂无付款记录', 'No payment records')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
