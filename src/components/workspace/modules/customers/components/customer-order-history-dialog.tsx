'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Loader2 } from 'lucide-react';

export type CustomerOrderHistoryOrder = {
  id: string;
  orderNo: string | null;
  invNo: string | null;
  amount: number;
  outstanding: number;
};

export type CustomerOrderHistoryReceipt = {
  id: string;
  receiptNo: string | null;
  orderNo: string | null;
  invNo: string | null;
  usd: number;
  status: string;
  date: string | null;
};

export type CustomerOrderHistory = {
  orders: CustomerOrderHistoryOrder[];
  receipts: CustomerOrderHistoryReceipt[];
};

export type CustomerOrderHistoryDialogProps = {
  open: boolean;
  loading: boolean;
  error: string;
  title: string;
  history: CustomerOrderHistory | null;
  tx: (zh: string, en: string) => string;
  onOpenChange: (open: boolean) => void;
};

function money(value: number) {
  return formatUsdAmount(value || 0);
}

export function CustomerOrderHistoryDialog({
  open,
  loading,
  error,
  title,
  history,
  tx,
  onOpenChange,
}: CustomerOrderHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-24px)] max-w-5xl flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{tx('ORDER_NAME 历史', 'ORDER_NAME History')}: {title || '-'}</DialogTitle>
          <DialogDescription>
            {tx('查看该客户在此 ORDER_NAME 下的历史订单，以及最近收据状态。', 'Review historical orders for this ORDER_NAME and recent receipt statuses.')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tx('加载中...', 'Loading...')}
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && (
            <div data-testid="customer-order-history-grid" className="grid gap-4 md:grid-cols-2">
              <section className="space-y-3">
                <h3 className="font-semibold">{tx('历史订单', 'Historical Orders')}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ORDER</TableHead>
                        <TableHead>INV NO</TableHead>
                        <TableHead>AMOUNT</TableHead>
                        <TableHead>Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history?.orders || []).map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                          <TableCell>{order.invNo || '-'}</TableCell>
                          <TableCell>{money(order.amount)}</TableCell>
                          <TableCell className={order.outstanding > 0 ? 'text-red-600' : undefined}>{money(order.outstanding)}</TableCell>
                        </TableRow>
                      ))}
                      {(!history?.orders || history.orders.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                            {tx('暂无历史订单', 'No historical orders')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="font-semibold">{tx('最近收据', 'Recent Receipts')}</h3>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Receipt</TableHead>
                        <TableHead>ORDER</TableHead>
                        <TableHead>USD</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history?.receipts || []).map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell className="font-medium">{receipt.receiptNo || '-'}</TableCell>
                          <TableCell>{formatOrderNameDisplay(receipt.orderNo)}</TableCell>
                          <TableCell>{money(receipt.usd)}</TableCell>
                          <TableCell><Badge variant="outline">{receipt.status || '-'}</Badge></TableCell>
                        </TableRow>
                      ))}
                      {(!history?.receipts || history.receipts.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                            {tx('暂无最近收据', 'No recent receipts')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
