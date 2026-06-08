import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dashboard } from './dashboard-view';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { useStore } from '@/lib/store';

jest.mock('@/components/workspace/shared', () => ({
  IMPORT_RESULT_PAGE_SIZE: 10,
  apiCall: jest.fn(async () => ({ success: true, data: null })),
  fetchCustomerCandidatesByMark: jest.fn(),
  fetchServerDate: jest.fn(),
  getApiResponseErrorMessage: jest.fn(async () => 'Export failed'),
  getDisplayImageUrl: jest.fn((value: string) => value),
  getErrorMessage: jest.fn((error: unknown) => String(error)),
  initCustomerImportRowViews: jest.fn(),
  initInvoiceImportRowViews: jest.fn(),
  mergeCustomerImportRowViews: jest.fn(),
  mergeInvoiceImportRowViews: jest.fn(),
  summarizeRowsForAlert: jest.fn(),
  toCustomerImportRowResults: jest.fn(),
  toCustomerImportRowResultsFromIssues: jest.fn(),
  toDateInputValue: jest.fn(),
  toInvoiceImportRowResults: jest.fn(),
  toInvoiceImportRowResultsFromIssues: jest.fn(),
  useLatestRequestGuard: jest.fn(),
  useUiText: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useStore: jest.fn(),
}));

jest.mock('next-intl', () => ({
  useLocale: jest.fn(() => 'en'),
  useTranslations: jest.fn(() => (key: string, values?: Record<string, unknown>) => {
    if (key === 'detailItems') return `${values?.count ?? 0} items`;
    if (key === 'total') return `Total ${values?.value ?? ''}`;
    return key;
  }),
}));

const mockApiCall = apiCall as jest.Mock;
const mockUseLatestRequestGuard = useLatestRequestGuard as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;
const mockUseStore = useStore as unknown as jest.Mock;

function makeSummary() {
  return {
    invoiceCount: 2,
    unpaidTotal: 1000,
    pendingReceipts: 0,
    pendingReceiptsAmount: 0,
    waitingSwift: 0,
    pendingDeletion: 0,
    recentReceipts: [],
    recentDetails: [],
    releasedInvoices: [],
    customerOutstanding: [
      {
        customerKey: 'customer:super-dt2',
        customerLabel: 'SUPER DT2',
        totalOutstanding: 1000,
        statusSubtotals: {
          inTransit: 250,
          released: 750,
        },
        orders: [
          {
            orderId: 'order-in-transit',
            orderNo: 'SUPER DT2-10',
            invNo: 'L25MH090004',
            outstanding: 250,
            statusGroup: 'IN_TRANSIT',
            releaseDate: null,
            daysSinceRelease: null,
          },
          {
            orderId: 'order-released',
            orderNo: 'SUPER DT2-09',
            invNo: 'L25MH090002',
            outstanding: 750,
            statusGroup: 'RELEASED',
            releaseDate: '2026-05-01T00:00:00.000Z',
            daysSinceRelease: 7,
          },
        ],
      },
    ],
  };
}

describe('Dashboard customer outstanding status dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLatestRequestGuard.mockReturnValue({ nextToken: jest.fn(() => 1), isLatest: jest.fn(() => true) });
    mockUseUiText.mockReturnValue((_zh: string, en: string) => en);
    mockUseStore.mockReturnValue({
      invoices: [],
      receipts: [],
      details: [],
      deletionRequests: [],
    });
    mockApiCall.mockResolvedValue({ success: true, data: makeSummary() });
  });

  it('shows customer outstanding rows split by transit and released status with subtotals', async () => {
    await act(async () => {
      render(<Dashboard />);
    });

    const customerButton = await screen.findByRole('button', { name: 'SUPER DT2' });
    expect(screen.getByText('In Transit: $250')).toBeInTheDocument();
    expect(screen.getByText('Released: $750')).toBeInTheDocument();

    fireEvent.click(customerButton);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('In Transit')).toBeInTheDocument();
    expect(within(dialog).getByText('Subtotal: $250')).toBeInTheDocument();
    expect(within(dialog).getByText('SUPER DT2-10')).toBeInTheDocument();
    expect(within(dialog).getByText('Released')).toBeInTheDocument();
    expect(within(dialog).getByText('Subtotal: $750')).toBeInTheDocument();
    expect(within(dialog).getByText('SUPER DT2-09')).toBeInTheDocument();
    expect(within(dialog).getByText('Days Since Release')).toBeInTheDocument();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
  });
});
