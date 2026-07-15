'use client';

import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { CustomerAnalyticsDetailDialog } from './customer-analytics-detail-dialog';
import type {
  CustomerAnalyticsDetailResponse,
  CustomerAnalyticsMetric,
  CustomerAnalyticsRankingRow,
} from '@/lib/customer-analytics-types';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((_error: unknown, fallback: string) => fallback),
  useUiText: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;

const customer: CustomerAnalyticsRankingRow = {
  rank: 1,
  customerId: 'customer-a',
  customerName: 'Alpha Company',
  mark: 'ALPHA',
  value: 12000,
};

const settings = {
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
};

function detailResponse(
  metric: CustomerAnalyticsMetric,
  detail: CustomerAnalyticsDetailResponse['detail'],
  overrides: Partial<CustomerAnalyticsDetailResponse> = {},
): CustomerAnalyticsDetailResponse {
  return {
    metric,
    asOf: '2026-07-15T12:00:00.000Z',
    settings,
    period: {
      start: metric === 'annual-amount' ? '2026-01-01T00:00:00.000Z' : '2025-07-01T00:00:00.000Z',
      endExclusive: metric === 'annual-amount' ? '2027-01-01T00:00:00.000Z' : '2026-07-01T00:00:00.000Z',
    },
    availableYears: metric === 'annual-amount' ? [2026] : [],
    quality: {
      missingReleaseDateOrders: 0,
      missingReleaseDateAmount: 0,
      receiptDateFallbacks: 0,
      unboundReceipts: 0,
      invalidOrderAmounts: 0,
      invalidReceiptAmounts: 0,
      futureDatedReceipts: 0,
    },
    customer: {
      id: 'customer-a',
      companyName: 'Alpha Company',
      name: 'Alpha Person',
      mark: 'ALPHA',
    },
    value: customer.value,
    detail,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof CustomerAnalyticsDetailDialog>> = {}) {
  const props: React.ComponentProps<typeof CustomerAnalyticsDetailDialog> = {
    open: true,
    metric: 'annual-amount',
    customer,
    rankingAsOf: '2026-07-15T12:00:00.000Z',
    rankingSettings: settings,
    year: 2026,
    onOpenChange: jest.fn(),
    ...overrides,
  };
  render(<CustomerAnalyticsDetailDialog {...props} />);
  return props;
}

describe('CustomerAnalyticsDetailDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUiText.mockReturnValue((_zh: string, en: string) => en);
  });

  it('renders annual order evidence and a reconciled total', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('annual-amount', {
        customerId: 'customer-a',
        total: 12000,
        orders: [{
          orderId: 'order-a',
          orderNo: 'ALPHA-01',
          invNo: 'INV-A',
          releaseDate: '2026-02-01T00:00:00.000Z',
          amount: 12000,
        }],
      }),
    });

    renderDialog();

    expect(await screen.findByText('ALPHA-01')).toBeInTheDocument();
    expect(mockApiCall).toHaveBeenCalledWith(
      'dashboard/customer-analytics?action=detail&metric=annual-amount&customerId=customer-a&year=2026&asOf=2026-07-15T12%3A00%3A00.000Z',
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('ORDER NO')).toBeInTheDocument();
    expect(within(table).getByText('INV NO')).toBeInTheDocument();
    expect(within(table).getByText('Release Date')).toBeInTheDocument();
    expect(within(table).getByText('Amount')).toBeInTheDocument();
    expect(within(table).getByText('INV-A')).toBeInTheDocument();
    expect(screen.getByText('Reconciled total: $12,000')).toBeInTheDocument();
  });

  it('renders twelve chronological payment months with receipt evidence and average', async () => {
    const months = Array.from({ length: 12 }, (_, index) => {
      const monthDate = new Date(Date.UTC(2025, 6 + index, 1));
      return {
        month: `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}`,
        total: index === 0 ? 12000 : 0,
        receipts: index === 0 ? [{
          receiptId: 'receipt-a',
          orderId: 'order-a',
          orderNo: 'ALPHA-01',
          amount: 12000,
          effectiveDate: '2025-07-15T00:00:00.000Z',
          usedDateFallback: false,
          isDeposit: true,
        }] : [],
      };
    });
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('payment-capacity', {
        customerId: 'customer-a',
        total: 12000,
        averageMonthly: 1000,
        months,
      }, { value: 1000 }),
    });

    renderDialog({ metric: 'payment-capacity', year: undefined });

    const averageSummary = (await screen.findByText('Average per month')).parentElement;
    expect(averageSummary).toHaveTextContent('Average per month');
    expect(averageSummary).toHaveTextContent('$1,000');
    expect(screen.getByText('12 completed months')).toBeInTheDocument();
    expect(screen.getByText('ALPHA-01')).toBeInTheDocument();
    expect(screen.getByText('Deposit')).toBeInTheDocument();
    expect(screen.getAllByTestId('customer-analytics-capacity-month')).toHaveLength(12);
  });

  it('renders cycle exposure, server risk, and per-order evidence', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('payment-cycle', {
        customerId: 'customer-a',
        rawDays: 52,
        roundedDays: 52,
        eligibleOrderCount: 1,
        eligibleAmount: 100000,
        paidAmount: 90000,
        overdueOutstanding: 10000,
        withinTermsOutstanding: 5000,
        orders: [{
          orderId: 'order-a',
          orderNo: 'ALPHA-01',
          invNo: 'INV-A',
          releaseDate: '2026-01-01T00:00:00.000Z',
          amount: 100000,
          paidAmount: 90000,
          outstanding: 10000,
          rawDays: 52,
          roundedDays: 52,
          riskBand: {
            id: 'mild-delay',
            minDays: 31,
            maxDays: 59,
            zh: '轻微拖延',
            en: 'Mild delay',
          },
        }],
      }, { value: 52 }),
    });

    renderDialog({ metric: 'payment-cycle', year: undefined });

    const eligibleOrdersSummary = (await screen.findByText('Eligible orders')).parentElement;
    expect(eligibleOrdersSummary).toHaveTextContent('Eligible orders');
    expect(eligibleOrdersSummary).toHaveTextContent('1');
    expect(screen.getByText('Eligible amount').parentElement).toHaveTextContent('$100,000');
    expect(screen.getByText('Current overdue').parentElement).toHaveTextContent('$10,000');
    expect(screen.getByText('Within normal terms').parentElement).toHaveTextContent('$5,000');
    expect(screen.getByRole('button', { name: 'Payment-cycle risk: 52 days' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Paid')).toBeInTheDocument();
    expect(within(table).getByText('Outstanding')).toBeInTheDocument();
  });

  it('shows loading, readable retry, and a refreshed-data notice', async () => {
    let rejectRequest!: (reason: unknown) => void;
    const pending = new Promise((_resolve, reject) => { rejectRequest = reject; });
    mockApiCall.mockReturnValueOnce(pending);
    renderDialog({ metric: 'payment-cycle', year: undefined, rankingAsOf: '2026-07-15T11:00:00.000Z' });

    expect(screen.getByText('Loading calculation evidence...')).toBeInTheDocument();
    rejectRequest(new Error('network'));
    expect(await screen.findByText('Customer analytics detail could not be loaded.')).toBeInTheDocument();

    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: detailResponse('payment-cycle', null, {
        asOf: '2026-07-15T11:00:00.000Z',
        value: 11000,
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Source data changed; this detail was refreshed.')).toBeInTheDocument();
    expect(screen.getByText('No calculation evidence for this customer.')).toBeInTheDocument();
  });

  it('does not claim source data changed from a timestamp difference alone', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('annual-amount', null, { asOf: '2026-07-15T12:01:00.000Z' }),
    });

    renderDialog({ rankingAsOf: '2026-07-15T12:00:00.000Z' });

    expect(await screen.findByText('No calculation evidence for this customer.')).toBeInTheDocument();
    expect(screen.queryByText('Source data changed; this detail was refreshed.')).not.toBeInTheDocument();
  });

  it('reports refreshed evidence when the applied settings changed', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('annual-amount', null, {
        settings: { ...settings, normalDays: 31 },
      }),
    });

    renderDialog();

    expect(await screen.findByText('Source data changed; this detail was refreshed.')).toBeInTheDocument();
  });

  it('is viewport-bounded, scrolls internally, and closes with Escape', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('annual-amount', null),
    });
    const onOpenChange = jest.fn();
    renderDialog({ onOpenChange });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('max-h-[calc(100dvh-1rem)]');
    expect(dialog).toHaveClass('w-[calc(100vw-1rem)]');
    expect(dialog).toHaveClass('max-w-[calc(100vw-1rem)]');
    expect(dialog).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('customer-analytics-detail-scroll')).toHaveClass('overflow-y-auto');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not render stale payment-capacity data as annual evidence while closing', async () => {
    mockApiCall.mockResolvedValue({
      success: true,
      data: detailResponse('payment-capacity', {
        customerId: 'customer-a',
        total: 12000,
        averageMonthly: 1000,
        months: [],
      }, { value: 1000 }),
    });

    function ClosingDialogHarness() {
      const [open, setOpen] = useState(true);
      return (
        <CustomerAnalyticsDetailDialog
          open={open}
          metric={open ? 'payment-capacity' : 'annual-amount'}
          customer={open ? customer : null}
          rankingAsOf="2026-07-15T12:00:00.000Z"
          rankingSettings={settings}
          year={undefined}
          onOpenChange={setOpen}
        />
      );
    }

    render(<ClosingDialogHarness />);

    expect(await screen.findByText('Average per month')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ignores a detail request that resolves after closing and reopening for another customer', async () => {
    const customerB: CustomerAnalyticsRankingRow = {
      ...customer,
      customerId: 'customer-b',
      customerName: 'Beta Company',
      mark: 'BETA',
      value: 5000,
    };
    let resolveStaleRequest!: (value: unknown) => void;
    const staleRequest = new Promise((resolve) => { resolveStaleRequest = resolve; });
    mockApiCall
      .mockReturnValueOnce(staleRequest)
      .mockResolvedValueOnce({
        success: true,
        data: detailResponse('annual-amount', {
          customerId: 'customer-b',
          total: 5000,
          orders: [{
            orderId: 'order-b',
            orderNo: 'BETA-01',
            invNo: 'INV-B',
            releaseDate: '2026-03-01T00:00:00.000Z',
            amount: 5000,
          }],
        }, {
          customer: {
            id: 'customer-b',
            companyName: 'Beta Company',
            name: 'Beta Person',
            mark: 'BETA',
          },
          value: 5000,
        }),
      });

    function ReopenDialogHarness() {
      const [selection, setSelection] = useState<{
        metric: CustomerAnalyticsMetric;
        customer: CustomerAnalyticsRankingRow;
      } | null>({ metric: 'payment-capacity', customer });
      return (
        <>
          <button
            type="button"
            onClick={() => setSelection({ metric: 'annual-amount', customer: customerB })}
          >
            Open Beta
          </button>
          <CustomerAnalyticsDetailDialog
            open={Boolean(selection)}
            metric={selection?.metric || 'annual-amount'}
            customer={selection?.customer || null}
            rankingAsOf="2026-07-15T12:00:00.000Z"
            rankingSettings={settings}
            year={selection?.metric === 'annual-amount' ? 2026 : undefined}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setSelection(null);
            }}
          />
        </>
      );
    }

    render(<ReopenDialogHarness />);

    expect(screen.getByText('Loading calculation evidence...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Beta' }));
    expect(await screen.findByText('BETA-01')).toBeInTheDocument();

    await act(async () => {
      resolveStaleRequest({
        success: true,
        data: detailResponse('payment-capacity', {
          customerId: 'customer-a',
          total: 12000,
          averageMonthly: 1000,
          months: [],
        }, { value: 1000 }),
      });
    });

    expect(screen.getByText('BETA-01')).toBeInTheDocument();
    expect(screen.queryByText('Average per month')).not.toBeInTheDocument();
  });
});
