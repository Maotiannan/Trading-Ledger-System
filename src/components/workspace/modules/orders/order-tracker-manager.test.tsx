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
      fireEvent.click(screen.getByRole('button', { name: /新增Order/ }));
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
      fireEvent.click(screen.getByRole('button', { name: /新增Order/ }));
      await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('SYSTEM NOTED')).not.toBeInTheDocument();
  });
});
