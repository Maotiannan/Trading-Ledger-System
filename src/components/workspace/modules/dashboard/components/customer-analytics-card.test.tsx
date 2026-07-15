'use client';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { apiCall, useUiText } from '@/components/workspace/shared';
import { CustomerAnalyticsCard } from './customer-analytics-card';
import type {
  CustomerAnalyticsMetric,
  CustomerAnalyticsRankingResponse,
  CustomerAnalyticsRankingRow,
} from '@/lib/customer-analytics-types';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  getErrorMessage: jest.fn((_error: unknown, fallback: string) => fallback),
  useUiText: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;

const settings = {
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
};

function row(index: number, overrides: Partial<CustomerAnalyticsRankingRow> = {}): CustomerAnalyticsRankingRow {
  return {
    rank: index,
    customerId: `customer-${index}`,
    customerName: `Customer ${index}`,
    mark: `MARK-${index}`,
    value: index * 1000,
    ...overrides,
  };
}

function response(
  metric: CustomerAnalyticsMetric,
  items: CustomerAnalyticsRankingRow[],
  overrides: Partial<CustomerAnalyticsRankingResponse> = {},
): CustomerAnalyticsRankingResponse {
  return {
    metric,
    asOf: '2026-07-15T12:00:00.000Z',
    settings,
    period: {
      start: metric === 'annual-amount' ? '2026-01-01T00:00:00.000Z' : '2025-07-01T00:00:00.000Z',
      endExclusive: metric === 'annual-amount' ? '2027-01-01T00:00:00.000Z' : '2026-07-01T00:00:00.000Z',
    },
    availableYears: metric === 'annual-amount' ? [2025, 2026] : [],
    quality: {
      missingReleaseDateOrders: 2,
      missingReleaseDateAmount: 5000,
      receiptDateFallbacks: 1,
      unboundReceipts: 0,
      invalidOrderAmounts: 0,
      invalidReceiptAmounts: 0,
      futureDatedReceipts: 0,
    },
    totalVisibleCustomers: 20,
    totalResultCustomers: items.length,
    items,
    ...overrides,
  };
}

function endpointMetric(endpoint: string): CustomerAnalyticsMetric {
  return new URL(`https://example.com/${endpoint}`).searchParams.get('metric') as CustomerAnalyticsMetric;
}

function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
}

describe('CustomerAnalyticsCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUiText.mockReturnValue((_zh: string, en: string) => en);
    mockApiCall.mockImplementation(async (endpoint: string) => {
      const metric = endpointMetric(endpoint);
      return { success: true, data: response(metric, [row(1)]) };
    });
  });

  it('loads only annual amount on mount and caches each tab after first success', async () => {
    render(<CustomerAnalyticsCard initialYear={2026} />);

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      'dashboard/customer-analytics?action=ranking&metric=annual-amount&year=2026',
    ));
    expect(mockApiCall).toHaveBeenCalledTimes(1);

    selectTab('Payment Capacity');
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      'dashboard/customer-analytics?action=ranking&metric=payment-capacity',
    ));
    selectTab('Order Amount');
    selectTab('Payment Capacity');

    expect(mockApiCall).toHaveBeenCalledTimes(2);
  });

  it('renders four row fields, keeps zero capacity rows, and reloads a selected year', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      const metric = endpointMetric(endpoint);
      return {
        success: true,
        data: response(metric, [row(1, {
          customerName: 'Alpha Company',
          mark: 'ALPHA',
          value: metric === 'payment-capacity' ? 0 : 125000,
        })]),
      };
    });
    render(<CustomerAnalyticsCard initialYear={2026} />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('1')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Alpha Company' })).toBeInTheDocument();
    expect(within(table).getByText('ALPHA')).toBeInTheDocument();
    expect(within(table).getByText('$125,000')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis year' }), { target: { value: '2025' } });
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      'dashboard/customer-analytics?action=ranking&metric=annual-amount&year=2025',
    ));

    selectTab('Payment Capacity');
    expect(await screen.findByText('$0')).toBeInTheDocument();
  });

  it('keeps independent ten-row pages at the fixed card bottom', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      const metric = endpointMetric(endpoint);
      return { success: true, data: response(metric, Array.from({ length: 11 }, (_, index) => row(index + 1))) };
    });
    render(<CustomerAnalyticsCard initialYear={2026} />);

    expect(await screen.findByRole('button', { name: 'Customer 10' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customer 11' })).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-card-pagination')).toHaveClass('mt-auto');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'Customer 11' })).toBeInTheDocument();

    selectTab('Payment Capacity');
    expect(await screen.findByText('1 / 2 (11)')).toBeInTheDocument();
    selectTab('Order Amount');
    expect(screen.getByText('2 / 2 (11)')).toBeInTheDocument();
  });

  it('shows server risk visuals and rule/quality explanations without persistent status text', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      const metric = endpointMetric(endpoint);
      const cycleRow = row(1, {
        value: 52,
        roundedDays: 52,
        rawValue: 52,
        overdueOutstanding: 10000,
        riskBand: {
          id: 'mild-delay',
          minDays: 31,
          maxDays: 59,
          zh: '轻微拖延',
          en: 'Mild delay',
        },
      });
      return { success: true, data: response(metric, metric === 'payment-cycle' ? [cycleRow] : [row(1)]) };
    });
    render(<CustomerAnalyticsCard initialYear={2026} />);

    selectTab('Payment Cycle');
    expect(await screen.findByRole('button', { name: 'Payment-cycle risk: 52 days' })).toHaveTextContent('52d');
    expect(screen.queryByText('Mild delay')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Customer analytics calculation rules' }));
    const help = await screen.findByTestId('customer-analytics-help-popover');
    expect(help).toHaveTextContent('amount-weighted');
    expect(help).toHaveTextContent('excludes only SIGNING_PENDING');
    expect(help).toHaveTextContent('Deposits count as payments');
    expect(help).toHaveTextContent('30 / 60 / 90 / 120 / 150 / 180 days');
    expect(help).toHaveTextContent('2 orders missing release dates');
    expect(help).toHaveTextContent('1 receipt used its creation time');
  });

  it('ignores a stale annual response when years are switched quickly', async () => {
    let resolve2025!: (value: unknown) => void;
    let resolve2026Refresh!: (value: unknown) => void;
    const pending2025 = new Promise((resolve) => { resolve2025 = resolve; });
    const pending2026Refresh = new Promise((resolve) => { resolve2026Refresh = resolve; });
    mockApiCall
      .mockResolvedValueOnce({ success: true, data: response('annual-amount', [row(1, { customerName: 'Initial 2026' })]) })
      .mockReturnValueOnce(pending2025)
      .mockReturnValueOnce(pending2026Refresh);
    render(<CustomerAnalyticsCard initialYear={2026} />);

    expect(await screen.findByRole('button', { name: 'Initial 2026' })).toBeInTheDocument();
    const yearSelect = screen.getByRole('combobox', { name: 'Analysis year' });
    fireEvent.change(yearSelect, { target: { value: '2025' } });
    fireEvent.change(yearSelect, { target: { value: '2026' } });

    resolve2026Refresh({
      success: true,
      data: response('annual-amount', [row(1, { customerName: 'Current 2026' })]),
    });
    expect(await screen.findByRole('button', { name: 'Current 2026' })).toBeInTheDocument();

    await act(async () => {
      resolve2025({
        success: true,
        data: response('annual-amount', [row(1, { customerName: 'Stale 2025' })]),
      });
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Stale 2025' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current 2026' })).toBeInTheDocument();
  });

  it('retries an active metric error and opens only the active metric detail', async () => {
    const onOpenDetail = jest.fn();
    mockApiCall.mockRejectedValueOnce(new Error('network'));
    render(<CustomerAnalyticsCard initialYear={2026} onOpenDetail={onOpenDetail} />);

    expect(await screen.findByText('Customer analytics could not be loaded.')).toBeInTheDocument();
    mockApiCall.mockResolvedValueOnce({ success: true, data: response('annual-amount', [row(1)]) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Customer 1' }));

    expect(onOpenDetail).toHaveBeenCalledWith({
      metric: 'annual-amount',
      row: expect.objectContaining({ customerId: 'customer-1' }),
      year: 2026,
    });
  });
});
