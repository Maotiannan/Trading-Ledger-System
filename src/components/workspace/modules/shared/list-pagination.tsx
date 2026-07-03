'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export type ListPaginationProps = {
  idPrefix: string;
  tx: (zh: string, en: string) => string;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  compact?: boolean;
  disabled?: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function ListPagination({
  idPrefix,
  tx,
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  pageSizeOptions,
  compact = false,
  disabled = false,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
}: ListPaginationProps) {
  const pageSizeLabel = tx('每页条数', 'Rows per page');
  const previousLabel = tx('上一页', 'Previous');
  const nextLabel = tx('下一页', 'Next');

  const controls = (
    <>
        <div className="flex shrink-0 items-center gap-2">
          <select
            id={`${idPrefix}-page-size`}
            aria-label={pageSizeLabel}
            className="border rounded-md px-3 py-2 text-sm"
            value={String(pageSize)}
            disabled={disabled}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label={previousLabel}
            onClick={onPreviousPage}
            disabled={disabled || currentPage === 1}
          >
            ←
          </Button>
          <span className="min-w-[5.5rem] text-center text-sm text-gray-600">
            {currentPage} / {totalPages} ({totalCount})
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label={nextLabel}
            onClick={onNextPage}
            disabled={disabled || currentPage === totalPages}
          >
            →
          </Button>
        </div>
    </>
  );

  if (compact) {
    return (
      <div
        data-testid="list-pagination-content"
        className="flex flex-row flex-nowrap items-center justify-center gap-1.5 py-2"
      >
        {controls}
      </div>
    );
  }

  return (
    <Card>
      <CardContent
        data-testid="list-pagination-content"
        className="flex flex-row flex-nowrap items-center justify-center gap-2 px-4 py-4"
      >
        {controls}
      </CardContent>
    </Card>
  );
}
