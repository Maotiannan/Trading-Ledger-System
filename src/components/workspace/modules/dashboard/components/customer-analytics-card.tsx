'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiCall, getErrorMessage, useUiText } from '@/components/workspace/shared';
import { formatAppDate, getAppYear } from '@/lib/app-time';
import { formatUsdAmount } from '@/lib/display-format';
import type {
  CustomerAnalyticsMetric,
  CustomerAnalyticsRankingResponse,
  CustomerAnalyticsRankingRow,
} from '@/lib/customer-analytics-types';
import { CustomerAnalyticsHint, CustomerAnalyticsRiskIndicator } from './customer-analytics-risk-indicator';
import { DashboardCardPagination } from './dashboard-card-pagination';

const PAGE_SIZE = 10;

const metricLabels: Record<CustomerAnalyticsMetric, { zh: string; en: string }> = {
  'annual-amount': { zh: '下单金额', en: 'Order Amount' },
  'payment-capacity': { zh: '付款能力', en: 'Payment Capacity' },
  'payment-cycle': { zh: '付款周期', en: 'Payment Cycle' },
};

type MetricViewState = {
  loading: boolean;
  error: string;
  response: CustomerAnalyticsRankingResponse | null;
  page: number;
  year?: number;
};

type MetricState = Record<CustomerAnalyticsMetric, MetricViewState>;

function emptyMetricState(): MetricState {
  return {
    'annual-amount': { loading: false, error: '', response: null, page: 1 },
    'payment-capacity': { loading: false, error: '', response: null, page: 1 },
    'payment-cycle': { loading: false, error: '', response: null, page: 1 },
  };
}

export type CustomerAnalyticsOpenDetail = {
  metric: CustomerAnalyticsMetric;
  row: CustomerAnalyticsRankingRow;
  year?: number;
};

export type CustomerAnalyticsCardProps = {
  initialYear?: number;
  onOpenDetail?: (input: CustomerAnalyticsOpenDetail) => void;
};

function metricEndpoint(metric: CustomerAnalyticsMetric, year: number): string {
  const query = new URLSearchParams({ action: 'ranking', metric });
  if (metric === 'annual-amount') query.set('year', String(year));
  return `dashboard/customer-analytics?${query.toString()}`;
}

function readRankingResponse(value: unknown): CustomerAnalyticsRankingResponse | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as CustomerAnalyticsRankingResponse;
  return Array.isArray(response.items) && response.period && response.quality ? response : null;
}

export function CustomerAnalyticsCard({
  initialYear = getAppYear(),
  onOpenDetail,
}: CustomerAnalyticsCardProps) {
  const tx = useUiText();
  const [activeMetric, setActiveMetric] = useState<CustomerAnalyticsMetric>('annual-amount');
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [metricState, setMetricState] = useState<MetricState>(emptyMetricState);
  const requestSequence = useRef<Record<CustomerAnalyticsMetric, number>>({
    'annual-amount': 0,
    'payment-capacity': 0,
    'payment-cycle': 0,
  });

  const loadMetric = useCallback(async (
    metric: CustomerAnalyticsMetric,
    year: number,
  ) => {
    const requestId = requestSequence.current[metric] + 1;
    requestSequence.current[metric] = requestId;
    setMetricState((current) => ({
      ...current,
      [metric]: { ...current[metric], loading: true, error: '' },
    }));
    try {
      const result = await apiCall(metricEndpoint(metric, year));
      const response = result.success ? readRankingResponse(result.data) : null;
      if (!response) {
        throw new Error(String(result.message || result.error || 'Invalid customer analytics response'));
      }
      if (requestSequence.current[metric] !== requestId) return;
      setMetricState((current) => ({
        ...current,
        [metric]: {
          loading: false,
          error: '',
          response,
          page: 1,
          ...(metric === 'annual-amount' ? { year } : {}),
        },
      }));
    } catch (error) {
      if (requestSequence.current[metric] !== requestId) return;
      setMetricState((current) => ({
        ...current,
        [metric]: {
          ...current[metric],
          loading: false,
          error: getErrorMessage(
            error,
            tx('客户分析加载失败。', 'Customer analytics could not be loaded.'),
          ),
        },
      }));
    }
  }, [tx]);

  useEffect(() => {
    void loadMetric('annual-amount', initialYear);
  }, [initialYear, loadMetric]);

  const handleMetricChange = (value: string) => {
    const metric = value as CustomerAnalyticsMetric;
    setActiveMetric(metric);
    const state = metricState[metric];
    const responseIsCurrent = metric !== 'annual-amount' || state.year === selectedYear;
    if (!state.loading && (!state.response || !responseIsCurrent)) {
      void loadMetric(metric, selectedYear);
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    void loadMetric('annual-amount', year);
  };

  const activeState = metricState[activeMetric];
  const response = activeMetric === 'annual-amount' && activeState.year !== selectedYear
    ? null
    : activeState.response;
  const totalPages = Math.max(1, Math.ceil((response?.items.length || 0) / PAGE_SIZE));
  const page = Math.min(activeState.page, totalPages);
  const rows = (response?.items || []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const yearOptions = useMemo(() => Array.from(new Set([
    selectedYear,
    ...(metricState['annual-amount'].response?.availableYears || []),
  ])).sort((left, right) => right - left), [metricState, selectedYear]);

  const setPage = (nextPage: number) => {
    setMetricState((current) => ({
      ...current,
      [activeMetric]: {
        ...current[activeMetric],
        page: Math.min(Math.max(1, nextPage), totalPages),
      },
    }));
  };

  const appliedSettings = response?.settings ?? {
    lookbackMonths: 12,
    normalDays: 30,
    mildDelayDays: 60,
    delayDays: 90,
    warningDays: 120,
    doubleWarningDays: 150,
    severeWarningDays: 180,
  };
  const helpContent = (
    <div className="space-y-2 leading-relaxed">
      <p className="font-semibold">{tx('客户分析计算规则', 'Customer analytics calculation rules')}</p>
      <p>{tx(
        '下单金额按发票放单日期归入所选自然年。',
        'Order Amount uses the invoice release date in the selected natural year.',
      )}</p>
      <p>{tx(
        `付款能力为前 ${appliedSettings.lookbackMonths} 个完整自然月收款总额除以月份数，零付款月份也计入。`,
        `Payment Capacity is total receipts across the previous ${appliedSettings.lookbackMonths} completed months divided by that month count, including zero-payment months.`,
      )}</p>
      <p>{tx(
        `付款周期按每笔已付及未付金额的等待天数做金额加权。放单后 ${appliedSettings.normalDays} 天内的未付款仍属正常账期。`,
        `Payment Cycle is amount-weighted across paid and unpaid exposure. Open balances within ${appliedSettings.normalDays} days after release remain inside normal terms.`,
      )}</p>
      <p>{tx(
        '所有正式收据状态都计入收款，只排除 SIGNING_PENDING；优先使用收据业务日期，缺失时使用创建时间，未来日期不计入当前结果。',
        'Every formal receipt status counts as payment; the calculation excludes only SIGNING_PENDING. It uses the receipt business date, falls back to creation time, and excludes future-dated receipts.',
      )}</p>
      <p>{tx(
        '定金计入付款能力；付款周期中，放单前定金按 0 个等待日减少放单时的未付金额。',
        'Deposits count as payments for capacity; in Payment Cycle, pre-release deposits reduce exposure at zero waiting days.',
      )}</p>
      <p>{tx(
        `风险分界（天）：${appliedSettings.normalDays} / ${appliedSettings.mildDelayDays} / ${appliedSettings.delayDays} / ${appliedSettings.warningDays} / ${appliedSettings.doubleWarningDays} / ${appliedSettings.severeWarningDays}。`,
        `Risk boundaries: ${appliedSettings.normalDays} / ${appliedSettings.mildDelayDays} / ${appliedSettings.delayDays} / ${appliedSettings.warningDays} / ${appliedSettings.doubleWarningDays} / ${appliedSettings.severeWarningDays} days.`,
      )}</p>
      {response ? (
        <p className="text-muted-foreground">
          {tx(
            `计算区间：${formatAppDate(response.period.start)} 至 ${formatAppDate(new Date(new Date(response.period.endExclusive).getTime() - 86_400_000))}；${response.quality.missingReleaseDateOrders} 个订单缺少放单日期；${response.quality.receiptDateFallbacks} 张收据使用创建时间；${response.quality.unboundReceipts} 张收据未绑定订单/客户；${response.quality.invalidOrderAmounts + response.quality.invalidReceiptAmounts} 条金额数据无效；${response.quality.futureDatedReceipts} 张未来日期收据被排除。`,
            `Period: ${formatAppDate(response.period.start)} to ${formatAppDate(new Date(new Date(response.period.endExclusive).getTime() - 86_400_000))}; ${response.quality.missingReleaseDateOrders} orders missing release dates; ${response.quality.receiptDateFallbacks} receipt${response.quality.receiptDateFallbacks === 1 ? '' : 's'} used its creation time; ${response.quality.unboundReceipts} unbound receipts; ${response.quality.invalidOrderAmounts + response.quality.invalidReceiptAmounts} invalid amount rows; ${response.quality.futureDatedReceipts} future-dated receipts excluded.`,
          )}
        </p>
      ) : null}
    </div>
  );

  const renderValue = (row: CustomerAnalyticsRankingRow) => {
    if (activeMetric !== 'payment-cycle') return formatUsdAmount(row.value, '$0');
    if (!row.riskBand || typeof row.roundedDays !== 'number') return `${Math.round(row.value)}d`;
    return (
      <CustomerAnalyticsRiskIndicator
        roundedDays={row.roundedDays}
        riskBand={row.riskBand}
        tx={tx}
      />
    );
  };

  return (
    <Card data-testid="customer-analytics-card" className="flex h-full flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{tx('客户分析', 'Customer Analytics')}</CardTitle>
            <CardDescription>
              {tx('按客户比较下单、付款和付款周期表现', 'Compare customer ordering, payment capacity, and payment cycle')}
            </CardDescription>
          </div>
          <CustomerAnalyticsHint
            ariaLabel={tx('客户分析计算规则', 'Customer analytics calculation rules')}
            testIdPrefix="customer-analytics-help"
            content={helpContent}
            triggerClassName="rounded-full p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            trigger={<CircleHelp className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
        <Tabs value={activeMetric} onValueChange={handleMetricChange}>
          <TabsList className="grid h-auto w-full grid-cols-3">
            {(Object.keys(metricLabels) as CustomerAnalyticsMetric[]).map((metric) => (
              <TabsTrigger key={metric} value={metric} className="px-1.5 text-xs sm:text-sm">
                {tx(metricLabels[metric].zh, metricLabels[metric].en)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {activeMetric === 'annual-amount' ? (
          <div className="flex justify-end">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{tx('年份', 'Year')}</span>
              <select
                aria-label={tx('分析年份', 'Analysis year')}
                value={selectedYear}
                onChange={(event) => handleYearChange(Number(event.target.value))}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-[520px] flex-1 flex-col space-y-3">
        {activeState.loading && !response ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : activeState.error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-destructive">{activeState.error}</p>
            <Button variant="outline" size="sm" onClick={() => void loadMetric(activeMetric, selectedYear)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tx('重试', 'Retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>{tx('客户', 'Customer')}</TableHead>
                    <TableHead>MARK</TableHead>
                    <TableHead className="text-right">{tx(metricLabels[activeMetric].zh, metricLabels[activeMetric].en)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.customerId}
                      tabIndex={0}
                      aria-label={tx(`打开 ${row.customerName} 客户分析明细`, `Open analytics detail for ${row.customerName}`)}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button')) return;
                        onOpenDetail?.({
                          metric: activeMetric,
                          row,
                          ...(activeMetric === 'annual-amount' ? { year: selectedYear } : {}),
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onOpenDetail?.({
                          metric: activeMetric,
                          row,
                          ...(activeMetric === 'annual-amount' ? { year: selectedYear } : {}),
                        });
                      }}
                    >
                      <TableCell>{row.rank}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          title={row.customerName || row.mark || '-'}
                          className="block max-w-[10rem] truncate text-left font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[14rem]"
                          onClick={() => onOpenDetail?.({
                            metric: activeMetric,
                            row,
                            ...(activeMetric === 'annual-amount' ? { year: selectedYear } : {}),
                          })}
                        >
                          {row.customerName || row.mark || '-'}
                        </button>
                      </TableCell>
                      <TableCell>{row.mark || '-'}</TableCell>
                      <TableCell className="text-right font-semibold">{renderValue(row)}</TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        {tx('当前指标暂无可排行客户', 'No customers qualify for this metric')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
            <DashboardCardPagination
              page={page}
              totalPages={totalPages}
              totalItems={response?.items.length || 0}
              tx={tx}
              onPrevious={() => setPage(page - 1)}
              onNext={() => setPage(page + 1)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
