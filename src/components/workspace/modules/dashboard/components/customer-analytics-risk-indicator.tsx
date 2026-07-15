'use client';

import { useState, type ReactNode } from 'react';
import {
  CircleAlert,
  Clock3,
  Gauge,
  OctagonAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CustomerAnalyticsRiskBand, CustomerAnalyticsRiskBandId } from '@/lib/customer-analytics-types';
import { cn } from '@/lib/utils';

const riskStyle: Record<CustomerAnalyticsRiskBandId, {
  className: string;
  icon: typeof ShieldCheck;
}> = {
  normal: { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: ShieldCheck },
  'mild-delay': { className: 'border-amber-200 bg-amber-50 text-amber-700', icon: Clock3 },
  'some-delay': { className: 'border-orange-200 bg-orange-50 text-orange-700', icon: Gauge },
  delayed: { className: 'border-orange-300 bg-orange-100 text-orange-800', icon: CircleAlert },
  warning: { className: 'border-red-200 bg-red-50 text-red-700', icon: TriangleAlert },
  'double-warning': { className: 'border-rose-300 bg-rose-100 text-rose-800', icon: OctagonAlert },
  'severe-warning': { className: 'border-red-400 bg-red-100 text-red-900', icon: OctagonAlert },
};

export type CustomerAnalyticsHintProps = {
  ariaLabel: string;
  trigger: ReactNode;
  content: ReactNode;
  triggerClassName?: string;
  testIdPrefix: string;
};

export function CustomerAnalyticsHint({
  ariaLabel,
  trigger,
  content,
  triggerClassName,
  testIdPrefix,
}: CustomerAnalyticsHintProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);

  return (
    <Popover>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              className={triggerClassName}
              onFocus={() => setTooltipOpen(true)}
              onBlur={() => setTooltipOpen(false)}
              onMouseEnter={() => setTooltipOpen(true)}
              onMouseLeave={() => setTooltipOpen(false)}
            >
              {trigger}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent data-testid={`${testIdPrefix}-tooltip`} className="max-w-xs">
          {content}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        data-testid={`${testIdPrefix}-popover`}
        align="end"
        className="max-h-[min(70dvh,28rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto text-sm"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export type CustomerAnalyticsRiskIndicatorProps = {
  roundedDays: number;
  riskBand: CustomerAnalyticsRiskBand;
  tx: (zh: string, en: string) => string;
};

export function CustomerAnalyticsRiskIndicator({
  roundedDays,
  riskBand,
  tx,
}: CustomerAnalyticsRiskIndicatorProps) {
  const style = riskStyle[riskBand.id];
  const Icon = style.icon;
  const range = riskBand.maxDays === null
    ? tx(`${riskBand.minDays} 天以上`, `${riskBand.minDays}+ days`)
    : tx(`${riskBand.minDays}–${riskBand.maxDays} 天`, `${riskBand.minDays}–${riskBand.maxDays} days`);
  const content = (
    <div className="space-y-1">
      <div className="font-semibold">{tx(riskBand.zh, riskBand.en)}</div>
      <div>{range}</div>
    </div>
  );

  return (
    <CustomerAnalyticsHint
      ariaLabel={tx(`付款周期风险：${roundedDays} 天`, `Payment-cycle risk: ${roundedDays} days`)}
      testIdPrefix="customer-analytics-risk"
      content={content}
      triggerClassName={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring',
        style.className,
      )}
      trigger={
        <>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{roundedDays}d</span>
        </>
      }
    />
  );
}
