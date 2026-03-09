'use client';

import { useMemo, useState } from 'react';
import { IMPORT_RESULT_PAGE_SIZE } from '@/components/workspace/hooks/import-results';

export type ImportResultRowBase = {
  rowNo: number;
  latestStatus: string;
  latestReason: string;
  attempts: Array<{ status: string; reason: string }>;
};

export function useImportResultTable<T extends ImportResultRowBase>(rows: T[]) {
  const [filter, setFilter] = useState<'failed' | 'all'>('failed');
  const [page, setPage] = useState(1);

  const latestFailedRows = useMemo(
    () => rows.filter((row) => row.latestStatus === 'FAILED'),
    [rows]
  );
  const attemptCount = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.attempts.length), 0),
    [rows]
  );
  const visibleRows = useMemo(() => {
    if (filter === 'failed') return latestFailedRows;
    return rows;
  }, [filter, latestFailedRows, rows]);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / IMPORT_RESULT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * IMPORT_RESULT_PAGE_SIZE;
    return visibleRows.slice(start, start + IMPORT_RESULT_PAGE_SIZE);
  }, [currentPage, visibleRows]);

  const updateFilter = (value: 'failed' | 'all') => {
    setFilter(value);
    setPage(1);
  };

  const updatePage = (updater: ((page: number) => number) | number) => {
    setPage((prev) => {
      const base = Math.min(prev, totalPages);
      const next = typeof updater === 'function' ? updater(base) : updater;
      return Math.max(1, Math.min(next, totalPages));
    });
  };

  const reset = () => {
    setFilter('failed');
    setPage(1);
  };

  return {
    filter,
    setFilter: updateFilter,
    page: currentPage,
    setPage: updatePage,
    latestFailedRows,
    attemptCount,
    totalPages,
    pagedRows,
    reset,
  };
}
