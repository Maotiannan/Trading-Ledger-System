'use client';

import { Button } from '@/components/ui/button';

export type DashboardCardPaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  tx: (zh: string, en: string) => string;
  onPrevious: () => void;
  onNext: () => void;
};

export function DashboardCardPagination({
  page,
  totalPages,
  totalItems,
  tx,
  onPrevious,
  onNext,
}: DashboardCardPaginationProps) {
  if (totalItems <= 0) {
    return <div data-testid="dashboard-card-pagination-placeholder" className="mt-auto h-9" />;
  }

  return (
    <div
      data-testid="dashboard-card-pagination"
      className="mt-auto flex items-center justify-end gap-2 pt-3 text-sm"
    >
      <Button
        variant="outline"
        size="sm"
        aria-label={tx('上一页', 'Previous')}
        disabled={page <= 1}
        onClick={onPrevious}
      >
        ←
      </Button>
      <span className="min-w-[5.5rem] text-center text-muted-foreground">
        {page} / {totalPages} ({totalItems})
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={tx('下一页', 'Next')}
        disabled={page >= totalPages}
        onClick={onNext}
      >
        →
      </Button>
    </div>
  );
}
