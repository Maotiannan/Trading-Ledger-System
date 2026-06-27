import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dashboard } from './dashboard-view';
import { apiCall, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/lib/dashboard-layout-preference';
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
    releasedInvoices: [
      {
        id: 'invoice-released',
        invNo: 'L25MH090002',
        releaseDate: '2026-05-01T00:00:00.000Z',
        daysSinceRelease: 7,
        outstanding: 1000,
        orders: [
          {
            orderId: 'order-high',
            orderNo: 'SUPER DT2-09',
            amount: 1500,
            outstanding: 750,
          },
          {
            orderId: 'order-low',
            orderNo: 'SUPER DT2-08',
            amount: 500,
            outstanding: 250,
          },
        ],
      },
    ],
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
    const rankingTable = screen.getByRole('columnheader', { name: 'ORDER_NAME' }).closest('table');
    expect(rankingTable).not.toBeNull();
    expect(within(rankingTable as HTMLTableElement).queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.queryByText('In Transit: $250')).not.toBeInTheDocument();
    expect(screen.queryByText('Released: $750')).not.toBeInTheDocument();

    fireEvent.click(customerButton);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Unpaid ORDER_NAME balances grouped by released and in-transit status.')).toBeInTheDocument();
    expect(within(dialog).getByText('Total Unpaid: $1,000')).toBeInTheDocument();

    const releasedLabel = within(dialog).getByText('Released');
    const inTransitLabel = within(dialog).getByText('In Transit');

    expect(releasedLabel.compareDocumentPosition(inTransitLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(releasedLabel).toBeInTheDocument();
    expect(within(dialog).getByText('Subtotal: $250')).toBeInTheDocument();
    expect(within(dialog).getByText('SUPER DT2-10')).toBeInTheDocument();
    expect(inTransitLabel).toBeInTheDocument();
    expect(within(dialog).getByText('Subtotal: $750')).toBeInTheDocument();
    expect(within(dialog).getByText('SUPER DT2-09')).toBeInTheDocument();
    expect(within(dialog).getByText('Days')).toBeInTheDocument();
    expect(within(dialog).getByText('7')).toBeInTheDocument();
  });

  it('opens released invoice order rows from the invoice number', async () => {
    await act(async () => {
      render(<Dashboard />);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'L25MH090002' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    const highOrder = within(dialog).getByText('SUPER DT2-09');
    const lowOrder = within(dialog).getByText('SUPER DT2-08');

    expect(within(dialog).getByText('ORDER_NAME')).toBeInTheDocument();
    expect(within(dialog).getByText('INV AMOUNT')).toBeInTheDocument();
    expect(within(dialog).getByText('OUT STANDING')).toBeInTheDocument();
    expect(highOrder.compareDocumentPosition(lowOrder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByText('$1,500')).toBeInTheDocument();
    expect(within(dialog).getByText('$750')).toBeInTheDocument();
  });

  it('does not render hidden dashboard cards or empty sections', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return {
        success: true,
        data: {
          imageCompressionEnabled: true,
          imageCompressionQualityFloor: 0.3,
          ocrTargetMaxKb: 500,
          dashboardLayout: {
            sections: [
              {
                id: 'summary',
                visible: true,
                cards: [
                  { id: 'invoice-balance', visible: false },
                  { id: 'pending-receipts', visible: false },
                  { id: 'waiting-swift', visible: false },
                  { id: 'pending-approvals', visible: false },
                ],
              },
              {
                id: 'analysis',
                visible: true,
                cards: [
                  { id: 'released-unpaid-invoices', visible: true },
                  { id: 'customer-outstanding-ranking', visible: false },
                ],
              },
              {
                id: 'recent',
                visible: true,
                cards: [
                  { id: 'recent-receipts', visible: false },
                  { id: 'recent-payment-details', visible: false },
                ],
              },
            ],
          },
        },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    expect(await screen.findByText('Released Unpaid Invoices')).toBeInTheDocument();
    expect(screen.queryByText(/Invoice Balance/)).not.toBeInTheDocument();
    expect(screen.queryByText('Customer Outstanding Ranking')).not.toBeInTheDocument();
    expect(screen.queryByText('recentReceipts')).not.toBeInTheDocument();
  });

  it('does not render per-card hide buttons on the dashboard page', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return {
        success: true,
        data: {
          imageCompressionEnabled: true,
          imageCompressionQualityFloor: 0.3,
          ocrTargetMaxKb: 500,
          dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
        },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    expect(await screen.findByText(/Invoice Balance/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hide / })).not.toBeInTheDocument();
    expect(mockApiCall).not.toHaveBeenCalledWith('settings', expect.anything());
  });

  it('searches receipts by ORDER NO from the dashboard card and reuses the query on pagination', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
      if (endpoint === 'dashboard/receipt-search?orderNo=PIKIN-20&page=1') return {
        success: true,
        data: {
          matched: true,
          inputOrderNo: 'PIKIN-20',
          matchedOrderNo: 'PIKIN-20',
          items: [{ id: 'receipt-1', orderNo: 'PIKIN-20', date: '2026-06-20T00:00:00.000Z', amount: 2500, status: 'SR_Received' }],
          pagination: { page: 1, pageSize: 10, totalItems: 11, totalPages: 2 },
        },
      };
      if (endpoint === 'dashboard/receipt-search?orderNo=PIKIN-20&page=2') return {
        success: true,
        data: {
          matched: true,
          inputOrderNo: 'PIKIN-20',
          matchedOrderNo: 'PIKIN-20',
          items: [{ id: 'receipt-2', orderNo: 'PIKIN-20', date: null, amount: 3000, status: 'RECEIVED' }],
          pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 },
        },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    const card = await screen.findByTestId('dashboard-order-receipt-search-card');
    fireEvent.change(within(card).getByLabelText('ORDER NO'), { target: { value: 'PIKIN-20' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Search' }));

    expect(await within(card).findByText('Matched ORDER NO: PIKIN-20')).toBeInTheDocument();
    expect(within(card).getByText('$2,500')).toBeInTheDocument();
    expect(screen.getAllByTestId('dashboard-card-pagination')).toHaveLength(3);

    fireEvent.click(within(card).getByRole('button', { name: 'Next' }));

    expect(await within(card).findByText('$3,000')).toBeInTheDocument();
    expect(mockApiCall).toHaveBeenCalledWith('dashboard/receipt-search?orderNo=PIKIN-20&page=2');
  });

  it('shows not found when ORDER NO matching fails and supports Enter search', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
      if (endpoint === 'dashboard/receipt-search?orderNo=UNKNOWN-01&page=1') return {
        success: true,
        data: {
          matched: false,
          inputOrderNo: 'UNKNOWN-01',
          matchedOrderNo: null,
          items: [],
          pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
        },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    const card = await screen.findByTestId('dashboard-order-receipt-search-card');
    const input = within(card).getByLabelText('ORDER NO');
    fireEvent.change(input, { target: { value: 'UNKNOWN-01' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(await within(card).findByText('ORDER NO not found')).toBeInTheDocument();
    expect(mockApiCall).toHaveBeenCalledWith('dashboard/receipt-search?orderNo=UNKNOWN-01&page=1');
  });
});
