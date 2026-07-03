import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerManager } from './customer-manager';
import { apiCall } from '@/components/workspace/shared';

const mockSaveOrderPageSize = jest.fn();
const mockSaveReceiptPageSize = jest.fn();
const mockRequestGuard = {
  nextToken: jest.fn(() => Symbol('request')),
  isLatest: jest.fn(() => true),
};

jest.mock('@/lib/store', () => ({
  useStore: () => ({ user: { id: 'admin-1', role: 'ADMIN' } }),
}));

jest.mock('@/components/workspace/modules/shared/use-list-page-size-preference', () => ({
  useListPageSizePreference: (key: string) => ({
    pageSize: 10,
    pageSizeOptions: [5, 10, 15, 20],
    savePageSize: key === 'customerHistoryOrders' ? mockSaveOrderPageSize : mockSaveReceiptPageSize,
  }),
}));

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  peekPrefetchedApiResult: jest.fn(() => null),
  rememberPrefetchedApiResult: jest.fn((_: string, result: unknown) => result),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)),
  useLatestRequestGuard: () => mockRequestGuard,
  useUiText: () => (zh: string) => zh,
}));

jest.mock('@/components/workspace/components/import-result-dialog', () => ({
  ImportResultDialog: () => null,
}));

jest.mock('@/components/workspace/hooks', () => ({
  useImportResultTable: () => ({
    latestFailedRows: [],
    reset: jest.fn(),
    filter: '',
    setFilter: jest.fn(),
    pagedRows: [],
    page: 1,
    totalPages: 1,
    setPage: jest.fn(),
    attemptCount: 0,
  }),
}));

jest.mock('./hooks', () => ({
  useCustomerImportColumns: () => [],
  useCustomerActions: () => ({
    loadOwnerOptions: jest.fn(async () => undefined),
    handleCreateOrUpdate: jest.fn(),
    handleDelete: jest.fn(),
    submitFix: jest.fn(),
    downloadCustomerImportTemplate: jest.fn(),
    handleCustomerExcelImport: jest.fn(),
    retryCustomerIssueRows: jest.fn(),
  }),
  useCustomerForms: () => ({
    customerImportInputRef: { current: null },
    showCreate: false,
    setShowCreate: jest.fn(),
    editing: null,
    setEditing: jest.fn(),
    fixingTarget: null,
    setFixingTarget: jest.fn(),
    customerImporting: false,
    setCustomerImporting: jest.fn(),
    customerImportRows: [],
    setCustomerImportRows: jest.fn(),
    showCustomerImportIssues: false,
    setShowCustomerImportIssues: jest.fn(),
    customerIssueSubmitting: false,
    setCustomerIssueSubmitting: jest.fn(),
    customerImportMessage: '',
    setCustomerImportMessage: jest.fn(),
    customerLongTextPreview: null,
    setCustomerLongTextPreview: jest.fn(),
    form: { mark: '', orderName: '', orderNames: [], name: '', phone: '', city: '', consignee: '', companyName: '', credit: '', companyAddress: '', ownerId: '' },
    setForm: jest.fn(),
    resetForm: jest.fn(),
    openEdit: jest.fn(),
    openFix: jest.fn(),
    closeCustomerImportDialog: jest.fn(),
    updateCustomerImportIssue: jest.fn(),
  }),
}));

jest.mock('./components', () => ({
  CustomerToolbar: () => null,
  CustomerFixDialog: () => null,
  CustomerFixQueue: () => null,
  CustomerFormDialog: () => null,
  CustomerLongTextPreviewDialog: () => null,
  CustomerOrderHistoryDialog: ({
    open,
    history,
    onOrderNextPage,
    onReceiptNextPage,
    onOrderPageSizeChange,
    onReceiptPageSizeChange,
  }: {
    open: boolean;
    history: { orderPagination?: { page: number }; receiptPagination?: { page: number } } | null;
    onOrderNextPage: () => void;
    onReceiptNextPage: () => void;
    onOrderPageSizeChange: (pageSize: number) => void;
    onReceiptPageSizeChange: (pageSize: number) => void;
  }) => open ? (
    <div>
      <span data-testid="history-order-page">{history?.orderPagination?.page || 0}</span>
      <span data-testid="history-receipt-page">{history?.receiptPagination?.page || 0}</span>
      <button type="button" onClick={onOrderNextPage}>next order page</button>
      <button type="button" onClick={onReceiptNextPage}>next receipt page</button>
      <button type="button" onClick={() => onOrderPageSizeChange(15)}>15 order rows</button>
      <button type="button" onClick={() => onReceiptPageSizeChange(5)}>5 receipt rows</button>
    </div>
  ) : null,
  CustomerList: ({
    onOpenConsignees,
    onOpenOrderNameHistory,
  }: {
    onOpenConsignees: (row: Record<string, unknown>) => void;
    onOpenOrderNameHistory: (row: Record<string, unknown>, orderName: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onOpenConsignees({ id: 'customer-1', mark: 'MAB', name: 'Customer' })}>
        open consignees
      </button>
      <button type="button" onClick={() => onOpenOrderNameHistory({ id: 'customer-1' }, 'MAB-1')}>
        open order history
      </button>
    </>
  ),
  CustomerConsigneeDialog: ({ open, inputValue, submitting, error, onInputChange, onAdd, onSetPrimary }: {
    open: boolean;
    inputValue: string;
    submitting: boolean;
    error: string;
    onInputChange: (value: string) => void;
    onAdd: () => void;
    onSetPrimary: (id: string) => void;
  }) => open ? (
    <div>
      <input aria-label="consignee input" value={inputValue} onChange={(event) => onInputChange(event.target.value)} />
      <button type="button" onClick={onAdd}>add consignee</button>
      <button type="button" onClick={() => onSetPrimary('consignee-2')}>set primary</button>
      <span data-testid="consignee-submitting">{submitting ? 'yes' : 'no'}</span>
      <span role="alert">{error}</span>
    </div>
  ) : null,
}));

const mockApiCall = apiCall as jest.Mock;

describe('CustomerManager consignee dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockImplementation(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === 'customer' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body || '{}')) as { action?: string };
        if (body.action === 'consignee-add') {
          throw new Error('CONSIGNEE过长');
        }
        return { success: true, data: {} };
      }
      if (endpoint.startsWith('customer?action=consignees')) {
        return { success: true, data: [] };
      }
      return { success: true, data: [] };
    });
  });

  it('stops the add spinner and shows an error when add CONSIGNEE fails', async () => {
    render(<CustomerManager />);

    fireEvent.click(screen.getByRole('button', { name: 'open consignees' }));
    fireEvent.change(screen.getByLabelText('consignee input'), { target: { value: 'Long consignee text' } });
    fireEvent.click(screen.getByRole('button', { name: 'add consignee' }));

    await waitFor(() => expect(screen.getByTestId('consignee-submitting')).toHaveTextContent('no'));
    expect(screen.getByRole('alert')).toHaveTextContent('CONSIGNEE过长');
  });

  it('submits a primary CONSIGNEE selection through the customer API', async () => {
    render(<CustomerManager />);

    fireEvent.click(screen.getByRole('button', { name: 'open consignees' }));
    fireEvent.click(screen.getByRole('button', { name: 'set primary' }));

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('customer', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'consignee-set-primary',
        customerId: 'customer-1',
        consigneeId: 'consignee-2',
      }),
    })));
  });
});

describe('CustomerManager order history pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiCall.mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('customer?action=order-history')) {
        const url = new URL(`https://example.com/api/${endpoint}`);
        const orderPage = Number(url.searchParams.get('orderPage') || 1);
        const receiptPage = Number(url.searchParams.get('receiptPage') || 1);
        return {
          success: true,
          data: {
            orders: [],
            receipts: [],
            orderPagination: { page: orderPage, pageSize: Number(url.searchParams.get('orderPageSize') || 10), totalItems: 21, totalPages: 3 },
            receiptPagination: { page: receiptPage, pageSize: Number(url.searchParams.get('receiptPageSize') || 10), totalItems: 12, totalPages: 2 },
          },
        };
      }
      return { success: true, data: [] };
    });
  });

  it('loads and changes the two history pages independently', async () => {
    render(<CustomerManager />);

    fireEvent.click(screen.getByRole('button', { name: 'open order history' }));
    await waitFor(() => expect(screen.getByTestId('history-order-page')).toHaveTextContent('1'));

    expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining(
      'orderPage=1&orderPageSize=10&receiptPage=1&receiptPageSize=10',
    ));

    fireEvent.click(screen.getByRole('button', { name: 'next order page' }));
    await waitFor(() => expect(screen.getByTestId('history-order-page')).toHaveTextContent('2'));
    expect(screen.getByTestId('history-receipt-page')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'next receipt page' }));
    await waitFor(() => expect(screen.getByTestId('history-receipt-page')).toHaveTextContent('2'));
    expect(screen.getByTestId('history-order-page')).toHaveTextContent('2');
  });

  it('persists each history page size and resets only that table to page one', async () => {
    render(<CustomerManager />);

    fireEvent.click(screen.getByRole('button', { name: 'open order history' }));
    await waitFor(() => expect(screen.getByTestId('history-order-page')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'next order page' }));
    await waitFor(() => expect(screen.getByTestId('history-order-page')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'next receipt page' }));
    await waitFor(() => expect(screen.getByTestId('history-receipt-page')).toHaveTextContent('2'));

    fireEvent.click(screen.getByRole('button', { name: '15 order rows' }));
    expect(mockSaveOrderPageSize).toHaveBeenCalledWith(15);
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining(
      'orderPage=1&orderPageSize=15&receiptPage=2&receiptPageSize=10',
    )));

    fireEvent.click(screen.getByRole('button', { name: '5 receipt rows' }));
    expect(mockSaveReceiptPageSize).toHaveBeenCalledWith(5);
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(expect.stringContaining(
      'orderPage=1&orderPageSize=15&receiptPage=1&receiptPageSize=5',
    )));
  });
});
