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

jest.mock('@/components/workspace/modules/receipts/components/receipt-image-preview-dialog', () => ({
  ReceiptImagePreviewDialog: ({ image }: {
    image: null | {
      url: string;
      orderNo: string;
      invNo: string;
      creator: string;
    };
  }) => (
    image ? (
      <div role="dialog">
        <div>Bound ORDER NO: {image.orderNo}</div>
        <div>Bound invoice: {image.invNo}</div>
        <div>Creator: {image.creator}</div>
        <img src={image.url} alt="Receipt image" />
      </div>
    ) : null
  ),
}));

jest.mock('./components/customer-analytics-card', () => ({
  CustomerAnalyticsCard: () => <div data-testid="customer-analytics-card">Customer Analytics</div>,
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

  it('renders the default-visible customer analytics card', async () => {
    await act(async () => {
      render(<Dashboard />);
    });

    expect(await screen.findByTestId('customer-analytics-card')).toBeInTheDocument();
  });

  it('searches visible customers only on submit and opens all ORDER_NAME history for one customer', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
      if (endpoint === 'dashboard/customer-history-search?action=search&query=Mamadou') return {
        success: true,
        data: {
          query: 'Mamadou',
          items: [
            {
              customerId: 'customer-mab',
              mark: 'MAB',
              name: 'Mamadou Aliou Barry',
              orderNames: ['MAB-1', 'MARY'],
            },
            {
              customerId: 'customer-pikin',
              mark: 'PIKIN',
              name: 'Mamadou Dian Diallo',
              orderNames: ['PIKIN'],
            },
          ],
        },
      };
      if (endpoint === 'dashboard/customer-history-search?action=history&customerId=customer-mab&orderPage=1&orderPageSize=10&receiptPage=1&receiptPageSize=10') return {
        success: true,
        data: {
          customer: { id: 'customer-mab', mark: 'MAB', name: 'Mamadou Aliou Barry' },
          orderNames: ['MAB-1', 'MARY'],
          orders: [
            { id: 'order-mab', orderNo: 'MAB-1-10', invNo: 'INV-1', amount: 1000, outstanding: 250 },
            { id: 'order-mary', orderNo: 'MARY-01', invNo: 'INV-2', amount: 500, outstanding: 100 },
          ],
          orderPagination: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 },
          receipts: [{
            id: 'receipt-1', receiptNo: '0010001', orderNo: 'MARY-01', invNo: 'INV-2', boundInvNo: 'INV-2',
            usd: 400, status: 'RECEIVED', date: '2026-07-01', createdAt: '2026-07-02T08:00:00.000Z',
            imageUrl: '/upload/images/receipts/ocr/mary.jpg', imageName: 'mary.jpg', creatorName: 'User', creatorEmail: 'user@example.com',
          }],
          receiptPagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
        },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    const card = await screen.findByTestId('dashboard-customer-history-search-card');
    fireEvent.change(within(card).getByLabelText('Customer search'), { target: { value: 'Mamadou' } });
    expect(mockApiCall).not.toHaveBeenCalledWith('dashboard/customer-history-search?action=search&query=Mamadou');
    fireEvent.click(within(card).getByRole('button', { name: 'Search' }));

    const results = await within(card).findByTestId('dashboard-customer-search-results');
    expect(results).toHaveClass('overflow-y-auto');
    expect(within(card).getByRole('button', { name: 'MAB' })).toHaveClass('text-blue-700');
    expect(within(card).getByRole('button', { name: 'MAB-1' })).toHaveClass('text-blue-700');
    expect(within(card).getByRole('button', { name: 'MARY' })).toHaveClass('text-blue-700');
    expect(within(card).getByRole('button', { name: 'Mamadou Aliou Barry' })).toHaveClass('text-blue-700');
    expect(within(card).getAllByRole('button', { name: 'PIKIN' })).toHaveLength(2);
    expect(within(card).queryByTestId('dashboard-card-pagination')).not.toBeInTheDocument();

    const mabRow = within(card).getByRole('button', { name: 'MAB' }).closest('tr');
    expect(mabRow).not.toBeNull();
    expect(within(mabRow as HTMLTableRowElement).getByRole('button', { name: 'MAB-1' })).toBeInTheDocument();
    expect(within(mabRow as HTMLTableRowElement).getByRole('button', { name: 'MARY' })).toBeInTheDocument();
    expect(within(mabRow as HTMLTableRowElement).getByRole('button', { name: 'Mamadou Aliou Barry' })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'MARY' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/MAB-1 \/ MARY/)).toBeInTheDocument();
    expect(within(dialog).getByText('MAB-1-10')).toBeInTheDocument();
    expect(within(dialog).getAllByText('MARY-01')).toHaveLength(2);
    expect(mockApiCall).toHaveBeenCalledWith('dashboard/customer-history-search?action=history&customerId=customer-mab&orderPage=1&orderPageSize=10&receiptPage=1&receiptPageSize=10');
  });

  it('supports Enter search and shows an empty customer result without pagination', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
      if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
      if (endpoint === 'dashboard/customer-history-search?action=search&query=UNKNOWN-01') return {
        success: true,
        data: { query: 'UNKNOWN-01', items: [] },
      };
      return { success: false };
    });

    await act(async () => {
      render(<Dashboard />);
    });

    const card = await screen.findByTestId('dashboard-customer-history-search-card');
    const input = within(card).getByLabelText('Customer search');
    fireEvent.change(input, { target: { value: 'UNKNOWN-01' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(await within(card).findByText('No matching customers')).toBeInTheDocument();
    expect(within(card).queryByTestId('dashboard-card-pagination')).not.toBeInTheDocument();
    expect(mockApiCall).toHaveBeenCalledWith('dashboard/customer-history-search?action=search&query=UNKNOWN-01');
  });
});
