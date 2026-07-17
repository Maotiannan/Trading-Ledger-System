import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrderTrackerManager } from './order-tracker-manager';
import { apiCall, lookupOrderContextByOrderNo, useLatestRequestGuard, useUiText } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(async () => ({ success: true, data: [] })),
  lookupOrderContextByOrderNo: jest.fn(),
  useLatestRequestGuard: jest.fn(),
  useUiText: jest.fn(),
}));

const mockApiCall = apiCall as jest.Mock;
const mockLookupOrderContextByOrderNo = lookupOrderContextByOrderNo as jest.Mock;
const mockUseLatestRequestGuard = useLatestRequestGuard as jest.Mock;
const mockUseUiText = useUiText as jest.Mock;

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    });
  }
});

async function renderManager() {
  await act(async () => {
    render(<OrderTrackerManager />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('OrderTrackerManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockApiCall.mockReset();
    mockLookupOrderContextByOrderNo.mockReset();
    mockUseLatestRequestGuard.mockReturnValue({ nextToken: jest.fn(() => 1), isLatest: jest.fn(() => true) });
    mockUseUiText.mockReturnValue((zh: string) => zh);
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('orders?action=customer-options')) {
        return {
          success: true,
          data: [{
            id: 'customer-pikin',
            mark: 'PIKIN',
            orderName: 'PIKIN',
            name: 'Mamadou Dian Diallo',
            companyName: null,
            phone: '622491286',
            city: 'Conakry',
            ownerId: 'sales-1',
            label: 'PIKIN / PIKIN / Mamadou Dian Diallo',
          }],
        };
      }
      return {
        success: true,
        data: [],
        meta: { statusOptions: ['In progress', 'Confirmed', 'Canceled'], defaultStatus: 'In progress' },
      };
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('auto-fills customer from the global ORDER context when creating a new Orders record', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValueOnce({
      matchedCustomer: { mark: 'PIKIN', name: 'PIKIN', customerId: 'customer-pikin' },
      orderSuggestion: null,
      invoiceSuggestion: null,
      phoneSuggestion: '622491286',
      payerSuggestion: 'Mamadou Dian Diallo "PIKIN"',
    });

    await renderManager();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新增订单/ }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('PIKIN-23'), { target: { value: 'PIKIN-23' } });
    });

    await act(async () => {
      jest.advanceTimersByTime(320);
    });

    await waitFor(() => {
      expect(mockLookupOrderContextByOrderNo).toHaveBeenCalledWith('PIKIN-23');
      expect(screen.getByText('已匹配客户：PIKIN / PIKIN / Mamadou Dian Diallo')).toBeInTheDocument();
    });
  });

  it('does not show SYSTEM NOTED in the create dialog', async () => {
    await renderManager();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新增订单/ }));
      await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('SYSTEM NOTED')).not.toBeInTheDocument();
  });

  it('removes the technical page description even in english locale', async () => {
    mockUseUiText.mockReturnValue((_zh: string, en: string) => en);

    await renderManager();

    expect(screen.queryByText('Independent business order tracking; it does not affect finance order balances or matching.')).not.toBeInTheDocument();
  });

  it('uses Chinese labels and truncates long customer labels in the create dialog', async () => {
    const longLabel = 'LONGMARK / LONGORDER / ETABLISSEMENTS MAMADOU DIALLO ET FRERES IMPORT EXPORT SARL CONAKRY';
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('orders?action=customer-options')) {
        return {
          success: true,
          data: [{
            id: 'customer-long',
            mark: 'LONGMARK',
            orderName: 'LONGORDER',
            name: 'ETABLISSEMENTS MAMADOU DIALLO ET FRERES IMPORT EXPORT SARL CONAKRY',
            companyName: null,
            phone: '622491286',
            city: 'Conakry',
            ownerId: 'sales-1',
            label: longLabel,
          }],
        };
      }
      return {
        success: true,
        data: [],
        meta: { statusOptions: ['In progress', 'Confirmed', 'Canceled'], defaultStatus: 'In progress' },
      };
    });

    await renderManager();

    expect(screen.getByRole('heading', { name: '订单管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增订单/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '状态' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '备注' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新增订单/ }));
      await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '新增订单' })).toBeInTheDocument();
    const customerTrigger = within(dialog).getByTestId('orders-customer-select-trigger');
    expect(customerTrigger).toHaveClass('min-w-0', 'overflow-hidden');

    await act(async () => {
      fireEvent.click(customerTrigger);
      await Promise.resolve();
    });

    const longOption = screen.getByTestId('orders-customer-option-customer-long');
    expect(longOption).toHaveClass('truncate');
    expect(longOption).toHaveAttribute('title', longLabel);
  });

  it('renders CONFIRMED DATE after DEPOSIT using Guinea date formatting', async () => {
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('orders?action=customer-options')) {
        return { success: true, data: [] };
      }
      return {
        success: true,
        data: [
          {
            id: 'tracker-confirmed',
            orderNo: 'PIKIN-30',
            status: 'Confirmed',
            confirmedAt: '2026-07-13T23:30:00.000Z',
            piStatus: false,
            remark: '',
            systemNote: '',
            customerId: 'customer-pikin',
            customerMark: 'PIKIN',
            customerName: 'PIKIN',
            customerPhone: '622491286',
            customerCity: 'Conakry',
            depositAmount: 500,
            canEdit: true,
            canEditAdminFields: false,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
          {
            id: 'tracker-progress',
            orderNo: 'MAB-02',
            status: 'In progress',
            confirmedAt: null,
            piStatus: false,
            remark: '',
            systemNote: '',
            customerId: 'customer-mab',
            customerMark: 'MAB',
            customerName: 'MAB-1',
            customerPhone: '620071176',
            customerCity: 'Conakry',
            depositAmount: 0,
            canEdit: true,
            canEditAdminFields: false,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
        meta: { statusOptions: ['In progress', 'Confirmed', 'Canceled'], defaultStatus: 'In progress' },
      };
    });

    await renderManager();

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    const depositIndex = headers.indexOf('定金');
    expect(headers.slice(depositIndex, depositIndex + 3)).toEqual(['定金', '确认日期', '客户']);
    expect(screen.getByText('13/07/2026')).toBeInTheDocument();

    const progressRow = screen.getByText('MAB-02').closest('tr');
    expect(progressRow).not.toBeNull();
    expect(within(progressRow as HTMLTableRowElement).getAllByRole('cell')[depositIndex + 1]).toHaveTextContent('-');
  });

  it('shows synchronized PI date and amount in the approved desktop column order', async () => {
    mockUseUiText.mockReturnValue((_zh: string, en: string) => en);
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('orders?action=customer-options')) {
        return { success: true, data: [] };
      }
      return {
        success: true,
        data: [
          {
            id: 'tracker-source',
            orderNo: 'AB-12',
            status: 'In progress',
            confirmedAt: null,
            piStatus: false,
            remark: '',
            systemNote: '',
            customerId: null,
            customerMark: null,
            customerName: null,
            customerPhone: null,
            customerCity: null,
            depositAmount: 0,
            piCreatedAt: '2026-07-18T00:30:00.000Z',
            piOfficialAmount: 30040,
            piCurrency: 'USD',
            sourceState: 'INACTIVE',
            sourceMatchStatus: 'UNMATCHED',
            sourceConflict: true,
            canEdit: false,
            canEditAdminFields: false,
            createdAt: '2026-07-18T00:30:00.000Z',
          },
          {
            id: 'tracker-manual',
            orderNo: 'LOCAL-01',
            status: 'Confirmed',
            confirmedAt: null,
            piStatus: false,
            remark: '',
            systemNote: '',
            customerId: 'customer-1',
            customerMark: 'LOCAL',
            customerName: 'LOCAL',
            customerPhone: null,
            customerCity: null,
            depositAmount: 0,
            piCreatedAt: null,
            piOfficialAmount: null,
            piCurrency: null,
            sourceState: null,
            sourceMatchStatus: null,
            sourceConflict: false,
            canEdit: true,
            canEditAdminFields: true,
            createdAt: '2026-07-18T00:30:00.000Z',
          },
        ],
        meta: { statusOptions: ['In progress', 'Confirmed', 'Canceled'], defaultStatus: 'In progress' },
      };
    });

    await renderManager();

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'ORDER',
      'PI CREATED DATE',
      'AMOUNT',
      'STATUS',
      'PI STATUS',
      'REMARK',
      'SYSTEM NOTED',
      'DEPOSIT',
      'CONFIRMED DATE',
      'CUSTOMER',
      'ACTIONS',
    ]);
    const sourceRow = screen.getByText('AB-12').closest('tr');
    const sourceCells = within(sourceRow as HTMLTableRowElement).getAllByRole('cell');
    expect(sourceCells[1]).toHaveTextContent('18/07/2026');
    expect(sourceCells[2]).toHaveTextContent('$30,040');
    expect(within(sourceRow as HTMLTableRowElement).getByText('Source inactive')).toBeInTheDocument();
    expect(within(sourceRow as HTMLTableRowElement).getByText('Customer match needed')).toBeInTheDocument();
    expect(within(sourceRow as HTMLTableRowElement).getByText('Source conflict')).toBeInTheDocument();

    const manualRow = screen.getByText('LOCAL-01').closest('tr');
    const manualCells = within(manualRow as HTMLTableRowElement).getAllByRole('cell');
    expect(manualCells[1]).toHaveTextContent('-');
    expect(manualCells[2]).toHaveTextContent('-');
  });

  it('does not submit admin-only fields when a sales-editable order is saved', async () => {
    mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint.startsWith('orders?action=customer-options')) {
        return {
          success: true,
          data: [],
        };
      }
      if (endpoint === 'orders' && options?.method === 'POST') {
        return { success: true, message: 'Order已更新', data: { id: 'tracker-1' } };
      }
      return {
        success: true,
        data: [{
          id: 'tracker-1',
          orderNo: 'FATAKO-01',
          status: 'In progress',
          piStatus: false,
          remark: '',
          systemNote: '',
          customerId: 'customer-fatako',
          customerMark: 'BAL2 FATAKO',
          customerName: 'FATAKO',
          customerPhone: '+224 623 63 65 09',
          customerCity: 'Conakry',
          depositAmount: 0,
          canEdit: true,
          canEditAdminFields: false,
          createdAt: '2026-05-18T00:00:00.000Z',
        }],
        meta: { statusOptions: ['In progress', 'Confirmed', 'Canceled'], defaultStatus: 'In progress' },
      };
    });

    await renderManager();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /修改/ }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存/ }));
      await Promise.resolve();
    });

    const updateCall = mockApiCall.mock.calls.find(([endpoint, options]) => endpoint === 'orders' && options?.method === 'POST');
    expect(updateCall).toBeTruthy();
    const body = JSON.parse(String(updateCall?.[1]?.body || '{}'));
    expect(body).toEqual(expect.objectContaining({
      action: 'update',
      orderId: 'tracker-1',
      status: 'In progress',
      remark: '',
    }));
    expect(body).not.toHaveProperty('piStatus');
    expect(body).not.toHaveProperty('systemNote');
  });
});
