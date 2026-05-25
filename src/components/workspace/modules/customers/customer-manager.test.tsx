import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomerManager } from './customer-manager';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/lib/store', () => ({
  useStore: () => ({ user: { id: 'admin-1', role: 'ADMIN' } }),
}));

jest.mock('@/components/workspace/shared', () => ({
  apiCall: jest.fn(),
  peekPrefetchedApiResult: jest.fn(() => null),
  rememberPrefetchedApiResult: jest.fn((_: string, result: unknown) => result),
  getErrorMessage: jest.fn((error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)),
  useLatestRequestGuard: () => ({ nextToken: () => Symbol('request'), isLatest: () => true }),
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
  CustomerOrderHistoryDialog: () => null,
  CustomerList: ({ onOpenConsignees }: { onOpenConsignees: (row: Record<string, unknown>) => void }) => (
    <button type="button" onClick={() => onOpenConsignees({ id: 'customer-1', mark: 'MAB', name: 'Customer' })}>
      open consignees
    </button>
  ),
  CustomerConsigneeDialog: ({ open, inputValue, submitting, error, onInputChange, onAdd }: {
    open: boolean;
    inputValue: string;
    submitting: boolean;
    error: string;
    onInputChange: (value: string) => void;
    onAdd: () => void;
  }) => open ? (
    <div>
      <input aria-label="consignee input" value={inputValue} onChange={(event) => onInputChange(event.target.value)} />
      <button type="button" onClick={onAdd}>add consignee</button>
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
        throw new Error('CONSIGNEE过长');
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
});
