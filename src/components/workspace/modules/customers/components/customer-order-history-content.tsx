'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListPagination } from '@/components/workspace/modules/shared/list-pagination';
import { formatAppDate } from '@/lib/app-time';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import { Loader2 } from 'lucide-react';
import { Fragment } from 'react';

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
  createdAt: string;
  boundInvNo?: string | null;
  imageUrl?: string | null;
  imageName?: string | null;
  creatorName?: string | null;
  creatorEmail?: string | null;
};

export type CustomerOrderHistoryPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type CustomerOrderHistory = {
  orders: CustomerOrderHistoryOrder[];
  orderPagination?: CustomerOrderHistoryPagination;
  receipts: CustomerOrderHistoryReceipt[];
  receiptPagination?: CustomerOrderHistoryPagination;
};

export type CustomerOrderHistoryContentProps = {
  loading: boolean;
  error: string;
  history: CustomerOrderHistory | null;
  tx: (zh: string, en: string) => string;
  orderPageSizeOptions: readonly number[];
  receiptPageSizeOptions: readonly number[];
  onOrderPreviousPage: () => void;
  onOrderNextPage: () => void;
  onOrderPageSizeChange: (pageSize: number) => void;
  onReceiptPreviousPage: () => void;
  onReceiptNextPage: () => void;
  onReceiptPageSizeChange: (pageSize: number) => void;
  onOpenReceiptImage?: (receipt: CustomerOrderHistoryReceipt) => void;
};

function money(value: number) {
  return formatUsdAmount(value || 0);
}

function OrderNoText({ value }: { value: string | null }) {
  const text = formatOrderNameDisplay(value);
  const parts = text.split('/');

  return parts.map((part, index) => (
    <Fragment key={`${part}-${index}`}>
      <span className="whitespace-nowrap">
        {part}{index < parts.length - 1 ? '/' : ''}
      </span>
      {index < parts.length - 1 && <wbr />}
    </Fragment>
  ));
}

export function CustomerOrderHistoryContent({
  loading,
  error,
  history,
  tx,
  orderPageSizeOptions,
  receiptPageSizeOptions,
  onOrderPreviousPage,
  onOrderNextPage,
  onOrderPageSizeChange,
  onReceiptPreviousPage,
  onReceiptNextPage,
  onReceiptPageSizeChange,
  onOpenReceiptImage,
}: CustomerOrderHistoryContentProps) {
  const showInitialLoading = loading && !history;

  return (
    <div className="min-h-0">
      {showInitialLoading && (
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

      {history && (
        <div data-testid="customer-order-history-scroll" className="md:min-w-0 md:max-w-full md:overflow-x-auto">
          <div data-testid="customer-order-history-grid" className="grid gap-4 md:w-max md:min-w-full md:grid-cols-[max-content_max-content] md:items-start">
            <section className="space-y-3 md:w-max">
              <h3 className="font-semibold">{tx('历史订单', 'Historical Orders')}</h3>
              <div className="rounded-md border">
                <Table data-testid="customer-order-history-orders-table" className="md:w-max md:table-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[13ch]">ORDER</TableHead>
                      <TableHead className="whitespace-nowrap">INV NO</TableHead>
                      <TableHead className="whitespace-nowrap">AMOUNT</TableHead>
                      <TableHead className="whitespace-nowrap">O/S</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell data-testid="customer-order-history-order-value" className="min-w-[13ch] font-medium"><OrderNoText value={order.orderNo} /></TableCell>
                        <TableCell className="whitespace-nowrap">{order.invNo || '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">{money(order.amount)}</TableCell>
                        <TableCell className={order.outstanding > 0 ? 'whitespace-nowrap text-red-600' : 'whitespace-nowrap'}>{money(order.outstanding)}</TableCell>
                      </TableRow>
                    ))}
                    {history.orders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                          {tx('暂无历史订单', 'No historical orders')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {history.orderPagination && (
                <ListPagination
                  idPrefix="customer-history-orders"
                  tx={tx}
                  currentPage={history.orderPagination.page}
                  totalPages={history.orderPagination.totalPages}
                  totalCount={history.orderPagination.totalItems}
                  pageSize={history.orderPagination.pageSize}
                  pageSizeOptions={orderPageSizeOptions}
                  compact
                  disabled={loading}
                  onPreviousPage={onOrderPreviousPage}
                  onNextPage={onOrderNextPage}
                  onPageSizeChange={onOrderPageSizeChange}
                />
              )}
            </section>

            <section className="space-y-3 md:w-max">
              <h3 className="font-semibold">{tx('最近收据', 'Recent Receipts')}</h3>
              <div className="rounded-md border">
                <Table data-testid="customer-order-history-receipts-table" className="md:w-max md:table-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">{tx('创建时间', 'Created At')}</TableHead>
                      <TableHead className="min-w-[13ch]">ORDER</TableHead>
                      <TableHead className="whitespace-nowrap">USD</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap">Receipt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.receipts.map((receipt) => (
                      <TableRow key={receipt.id}>
                        <TableCell className="whitespace-nowrap">{formatAppDate(receipt.createdAt)}</TableCell>
                        <TableCell data-testid="customer-order-history-order-value" className="min-w-[13ch]"><OrderNoText value={receipt.orderNo} /></TableCell>
                        <TableCell className="whitespace-nowrap">{money(receipt.usd)}</TableCell>
                        <TableCell className="whitespace-nowrap"><Badge variant="outline">{receipt.status || '-'}</Badge></TableCell>
                        <TableCell className="whitespace-nowrap font-medium">
                          {receipt.imageUrl && onOpenReceiptImage ? (
                            <button
                              type="button"
                              className="text-blue-700 underline-offset-2 hover:underline"
                              onClick={() => onOpenReceiptImage(receipt)}
                            >
                              {receipt.receiptNo || '-'}
                            </button>
                          ) : receipt.receiptNo || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {history.receipts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          {tx('暂无最近收据', 'No recent receipts')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {history.receiptPagination && (
                <ListPagination
                  idPrefix="customer-history-receipts"
                  tx={tx}
                  currentPage={history.receiptPagination.page}
                  totalPages={history.receiptPagination.totalPages}
                  totalCount={history.receiptPagination.totalItems}
                  pageSize={history.receiptPagination.pageSize}
                  pageSizeOptions={receiptPageSizeOptions}
                  compact
                  disabled={loading}
                  onPreviousPage={onReceiptPreviousPage}
                  onNextPage={onReceiptNextPage}
                  onPageSizeChange={onReceiptPageSizeChange}
                />
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
