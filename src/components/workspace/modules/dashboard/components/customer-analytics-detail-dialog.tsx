'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiCall, getErrorMessage, useUiText } from '@/components/workspace/shared';
import { formatAppDate, formatAppDateTime } from '@/lib/app-time';
import { formatOrderNameDisplay, formatUsdAmount } from '@/lib/display-format';
import type {
  CustomerAnalyticsAnnualDetailDto,
  CustomerAnalyticsCapacityDetailDto,
  CustomerAnalyticsCycleDetailDto,
  CustomerAnalyticsDetailResponse,
  CustomerAnalyticsMetric,
  CustomerAnalyticsRankingRow,
  CustomerAnalyticsSettings,
} from '@/lib/customer-analytics-types';
import { CustomerAnalyticsRiskIndicator } from './customer-analytics-risk-indicator';

const metricLabels: Record<CustomerAnalyticsMetric, { zh: string; en: string }> = {
  'annual-amount': { zh: '下单金额', en: 'Order Amount' },
  'payment-capacity': { zh: '付款能力', en: 'Payment Capacity' },
  'payment-cycle': { zh: '付款周期', en: 'Payment Cycle' },
};

export type CustomerAnalyticsDetailDialogProps = {
  open: boolean;
  metric: CustomerAnalyticsMetric;
  customer: CustomerAnalyticsRankingRow | null;
  rankingAsOf: string | null;
  rankingSettings: CustomerAnalyticsSettings | null;
  year?: number;
  onOpenChange: (open: boolean) => void;
};

function detailEndpoint(input: {
  metric: CustomerAnalyticsMetric;
  customerId: string;
  year?: number;
  asOf?: string;
}): string {
  const query = new URLSearchParams({
    action: 'detail',
    metric: input.metric,
    customerId: input.customerId,
  });
  if (input.metric === 'annual-amount' && input.year !== undefined) {
    query.set('year', String(input.year));
  }
  if (input.asOf) query.set('asOf', input.asOf);
  return `dashboard/customer-analytics?${query.toString()}`;
}

function settingsMatch(
  left: CustomerAnalyticsSettings,
  right: CustomerAnalyticsSettings,
): boolean {
  return left.lookbackMonths === right.lookbackMonths
    && left.normalDays === right.normalDays
    && left.mildDelayDays === right.mildDelayDays
    && left.delayDays === right.delayDays
    && left.warningDays === right.warningDays
    && left.doubleWarningDays === right.doubleWarningDays
    && left.severeWarningDays === right.severeWarningDays;
}

function readDetailResponse(
  value: unknown,
  metric: CustomerAnalyticsMetric,
  customerId: string,
): CustomerAnalyticsDetailResponse | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as CustomerAnalyticsDetailResponse;
  if (response.metric !== metric || response.customer?.id !== customerId || !response.period) return null;
  return response;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function AnnualEvidence({
  detail,
  tx,
}: {
  detail: CustomerAnalyticsAnnualDetailDto;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="text-right font-semibold text-blue-700">
        {tx(`核对总计：${formatUsdAmount(detail.total)}`, `Reconciled total: ${formatUsdAmount(detail.total)}`)}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">ORDER NO</TableHead>
              <TableHead className="whitespace-nowrap">INV NO</TableHead>
              <TableHead className="whitespace-nowrap">{tx('放单日期', 'Release Date')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('金额', 'Amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.orders.map((order) => (
              <TableRow key={order.orderId}>
                <TableCell className="whitespace-nowrap font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                <TableCell className="whitespace-nowrap">{order.invNo || '-'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatAppDate(order.releaseDate)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatUsdAmount(order.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CapacityEvidence({
  detail,
  tx,
}: {
  detail: CustomerAnalyticsCapacityDetailDto;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryItem label={tx('期间收款总额', 'Period total')} value={formatUsdAmount(detail.total)} />
        <SummaryItem label={tx('月均付款', 'Average per month')} value={formatUsdAmount(detail.averageMonthly)} />
        <SummaryItem label={tx('完整月份', 'Completed months')} value={tx(`${detail.months.length} 个月`, `${detail.months.length} completed months`)} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">{tx('月份', 'Month')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('月合计', 'Monthly Total')}</TableHead>
              <TableHead>{tx('收据证据', 'Receipt Evidence')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.months.map((month) => (
              <TableRow key={month.month} data-testid="customer-analytics-capacity-month">
                <TableCell className="whitespace-nowrap font-medium">{month.month}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatUsdAmount(month.total, '$0')}</TableCell>
                <TableCell className="min-w-[18rem]">
                  {month.receipts.length === 0 ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <div className="space-y-1.5">
                      {month.receipts.map((receipt) => (
                        <div key={receipt.receiptId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="font-medium">{formatOrderNameDisplay(receipt.orderNo)}</span>
                          <span className="whitespace-nowrap">{formatAppDate(receipt.effectiveDate)}</span>
                          <span className="whitespace-nowrap font-semibold">{formatUsdAmount(receipt.amount)}</span>
                          {receipt.isDeposit ? <Badge variant="outline">{tx('定金', 'Deposit')}</Badge> : null}
                          {receipt.usedDateFallback ? <Badge variant="secondary">{tx('创建时间', 'Creation time')}</Badge> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CycleEvidence({
  detail,
  tx,
}: {
  detail: CustomerAnalyticsCycleDetailDto;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryItem label={tx('有效订单', 'Eligible orders')} value={String(detail.eligibleOrderCount)} />
        <SummaryItem label={tx('有效金额', 'Eligible amount')} value={formatUsdAmount(detail.eligibleAmount)} />
        <SummaryItem label={tx('已付款', 'Paid amount')} value={formatUsdAmount(detail.paidAmount)} />
        <SummaryItem label={tx('当前逾期', 'Current overdue')} value={formatUsdAmount(detail.overdueOutstanding)} />
        <SummaryItem label={tx('正常账期内', 'Within normal terms')} value={formatUsdAmount(detail.withinTermsOutstanding)} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">ORDER NO</TableHead>
              <TableHead className="whitespace-nowrap">INV NO</TableHead>
              <TableHead className="whitespace-nowrap">{tx('放单日期', 'Release Date')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('金额', 'Amount')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('已付', 'Paid')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('未付', 'Outstanding')}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{tx('周期', 'Cycle')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.orders.map((order) => (
              <TableRow key={order.orderId}>
                <TableCell className="whitespace-nowrap font-medium">{formatOrderNameDisplay(order.orderNo)}</TableCell>
                <TableCell className="whitespace-nowrap">{order.invNo || '-'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatAppDate(order.releaseDate)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatUsdAmount(order.amount)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatUsdAmount(order.paidAmount)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatUsdAmount(order.outstanding, '$0')}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <CustomerAnalyticsRiskIndicator roundedDays={order.roundedDays} riskBand={order.riskBand} tx={tx} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function CustomerAnalyticsDetailDialog({
  open,
  metric,
  customer,
  rankingAsOf,
  rankingSettings,
  year,
  onOpenChange,
}: CustomerAnalyticsDetailDialogProps) {
  const tx = useUiText();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<CustomerAnalyticsDetailResponse | null>(null);
  const requestSequence = useRef(0);

  const loadDetail = useCallback(async () => {
    if (!customer) return;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoading(true);
    setError('');
    try {
      const result = await apiCall(detailEndpoint({
        metric,
        customerId: customer.customerId,
        year,
        asOf: rankingAsOf || undefined,
      }));
      const detail = result.success
        ? readDetailResponse(result.data, metric, customer.customerId)
        : null;
      if (!detail) throw new Error(String(result.message || result.error || 'Invalid detail response'));
      if (requestSequence.current !== requestId) return;
      setResponse(detail);
    } catch (loadError) {
      if (requestSequence.current !== requestId) return;
      setError(getErrorMessage(
        loadError,
        tx('客户分析明细加载失败。', 'Customer analytics detail could not be loaded.'),
      ));
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, [customer, metric, rankingAsOf, tx, year]);

  useEffect(() => {
    if (!open || !customer) return undefined;
    setResponse(null);
    void loadDetail();
    return () => {
      requestSequence.current += 1;
    };
  }, [customer, loadDetail, open]);

  const currentResponse = response
    && customer
    && response.metric === metric
    && response.customer?.id === customer.customerId
    ? response
    : null;
  const refreshed = Boolean(currentResponse && customer && (
    currentResponse.value !== customer.value
    || (rankingSettings && !settingsMatch(currentResponse.settings, rankingSettings))
  ));
  const annualDetail = metric === 'annual-amount' ? currentResponse?.detail as CustomerAnalyticsAnnualDetailDto | null : null;
  const capacityDetail = metric === 'payment-capacity' ? currentResponse?.detail as CustomerAnalyticsCapacityDetailDto | null : null;
  const cycleDetail = metric === 'payment-cycle' ? currentResponse?.detail as CustomerAnalyticsCycleDetailDto | null : null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestSequence.current += 1;
      setResponse(null);
      setError('');
      setLoading(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle>
            {tx(metricLabels[metric].zh, metricLabels[metric].en)} · {customer?.customerName || customer?.mark || '-'}
          </DialogTitle>
          <DialogDescription>
            {tx(
              `MARK：${customer?.mark || '-'}；计算时间：${formatAppDateTime(currentResponse?.asOf || rankingAsOf)}`,
              `MARK: ${customer?.mark || '-'}; calculated at ${formatAppDateTime(currentResponse?.asOf || rankingAsOf)}`,
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="customer-analytics-detail-scroll"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          {refreshed ? (
            <Alert>
              <AlertDescription>
                {tx('源数据已变化，本明细已按最新数据刷新。', 'Source data changed; this detail was refreshed.')}
              </AlertDescription>
            </Alert>
          ) : null}

          {loading && !currentResponse ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {tx('正在加载计算证据...', 'Loading calculation evidence...')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void loadDetail()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tx('重试', 'Retry')}
              </Button>
            </div>
          ) : currentResponse?.detail ? (
            <>
              {annualDetail ? <AnnualEvidence detail={annualDetail} tx={tx} /> : null}
              {capacityDetail ? <CapacityEvidence detail={capacityDetail} tx={tx} /> : null}
              {cycleDetail ? <CycleEvidence detail={cycleDetail} tx={tx} /> : null}
            </>
          ) : currentResponse ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {tx('该客户当前没有可展示的计算证据。', 'No calculation evidence for this customer.')}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
