'use client';

import React, { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type ResponsiveFilterCardProps = {
  testIdPrefix: string;
  filterLabel: string;
  renderSearch: () => React.ReactNode;
  renderFilters: () => React.ReactNode;
  renderActions?: () => React.ReactNode;
  renderMobileSearchAction?: () => React.ReactNode;
};

export function ResponsiveFilterCard({
  testIdPrefix,
  filterLabel,
  renderSearch,
  renderFilters,
  renderActions,
  renderMobileSearchAction,
}: ResponsiveFilterCardProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const filterContentClassName = cn(
    'grid grid-cols-1 gap-3 md:grid md:grid-cols-3 lg:grid-cols-6',
    mobileExpanded ? 'mt-3' : 'hidden md:grid',
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <div
          data-testid={`${testIdPrefix}-mobile-filter-bar`}
          className="flex items-center gap-2 md:hidden"
        >
          <div className="min-w-0 flex-1">{renderSearch()}</div>
          {renderMobileSearchAction?.()}
          <Button
            type="button"
            variant="outline"
            aria-label={filterLabel}
            onClick={() => setMobileExpanded((value) => !value)}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            {filterLabel}
          </Button>
        </div>

        <div
          data-testid={`${testIdPrefix}-mobile-filter-content`}
          data-expanded={mobileExpanded ? 'true' : 'false'}
          className={filterContentClassName}
        >
          <div className="hidden md:block">{renderSearch()}</div>
          {renderFilters()}
          {renderActions?.()}
        </div>
      </CardContent>
    </Card>
  );
}
