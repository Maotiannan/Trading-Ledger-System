'use client';

import { useEffect, useState } from 'react';
import { apiCall } from '@/components/workspace/api/client';
import { OrderHistoryDialog, type OrderHistoryDialogProps } from './order-history-dialog';

type Pagination = NonNullable<OrderHistoryDialogProps['pagination']>;
type Query = { page: number; pageSize: number; attempt: number };
type Result = { query: Query; rows: OrderHistoryDialogProps['rows']; pagination?: Pagination; failed?: boolean };

export function OrderPaymentHistoryDialog({ orderId, title, tx, onClose }: {
  orderId: string; title: string; tx: OrderHistoryDialogProps['tx']; onClose: () => void;
}) {
  const [query, setQuery] = useState<Query>({ page: 1, pageSize: 10, attempt: 0 });
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ orderId, page: String(query.page), pageSize: String(query.pageSize) });
    async function load() {
      try {
        const response = await apiCall(`invoice?${params}`, { signal: controller.signal });
        if (!response.success || !Array.isArray(response.data) || !response.pagination) throw new Error('Invalid history response');
        if (!controller.signal.aborted) setResult({ query, rows: response.data, pagination: response.pagination });
      } catch {
        if (!controller.signal.aborted) setResult({ query, rows: [], failed: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [orderId, query]);

  const loading = result?.query !== query;
  const pagination = result?.pagination;
  return <OrderHistoryDialog open title={title} tx={tx} rows={result?.rows ?? []}
    loading={loading} failed={!loading && result?.failed} pagination={pagination}
    onRetry={() => setQuery({ ...query, attempt: query.attempt + 1 })}
    onPreviousPage={() => pagination && setQuery({ ...query, page: Math.max(1, pagination.page - 1) })}
    onNextPage={() => pagination && setQuery({ ...query, page: Math.min(pagination.totalPages, pagination.page + 1) })}
    onPageSizeChange={pageSize => setQuery({ ...query, pageSize, page: 1 })}
    onOpenChange={open => { if (!open) onClose(); }} />;
}
