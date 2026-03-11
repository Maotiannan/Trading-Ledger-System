import { act, renderHook } from '@testing-library/react';
import { useCustomerActions } from './use-customer-actions';
import type { CustomerFormState } from '../types';
import { apiCall, getApiResponseErrorMessage, getErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    getApiResponseErrorMessage: jest.fn(async (_response: Response, fallback: string) => fallback),
    getErrorMessage: jest.fn((error: unknown, fallback: string) => {
      if (error && typeof error === 'object' && 'error' in (error as Record<string, unknown>)) {
        return String((error as Record<string, unknown>).error || fallback);
      }
      return error instanceof Error ? error.message : fallback;
    }),
    initCustomerImportRowViews: jest.fn((rows) => rows),
    mergeCustomerImportRowViews: jest.fn((prev, next) => [...prev, ...next]),
    toCustomerImportRowResults: jest.fn((rows) => rows || []),
    toCustomerImportRowResultsFromIssues: jest.fn((rows) => rows || []),
  };
});

const mockApiCall = apiCall as jest.Mock;
const mockGetApiResponseErrorMessage = getApiResponseErrorMessage as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;

describe('useCustomerActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const loadCustomers = jest.fn(async () => undefined);
  const loadFixes = jest.fn(async () => undefined);
  const setOwnerOptions = jest.fn();
  const setShowCreate = jest.fn();
  const setEditing = jest.fn();
  const setFixingTarget = jest.fn();
  const setCustomerImporting = jest.fn();
  const setCustomerImportRows = jest.fn();
  const setShowCustomerImportIssues = jest.fn();
  const setCustomerIssueSubmitting = jest.fn();
  const setCustomerImportMessage = jest.fn();
  const resetForm = jest.fn();
  const resetImportTable = jest.fn();
  let importOwnerId = '';
  let formState: CustomerFormState;

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetApiResponseErrorMessage.mockClear();
    mockGetErrorMessage.mockClear();
    loadCustomers.mockClear();
    loadFixes.mockClear();
    setOwnerOptions.mockClear();
    setShowCreate.mockClear();
    setEditing.mockClear();
    setFixingTarget.mockClear();
    setCustomerImporting.mockClear();
    setCustomerImportRows.mockClear();
    setShowCustomerImportIssues.mockClear();
    setCustomerIssueSubmitting.mockClear();
    setCustomerImportMessage.mockClear();
    resetForm.mockClear();
    resetImportTable.mockClear();
    importOwnerId = '';
    formState = {
      mark: 'MAB-1',
      orderName: 'MAB-1',
      name: 'Customer',
      phone: '620000001',
      city: 'Conakry',
      consignee: '',
      companyName: '',
      credit: '',
      companyAddress: '',
      ownerId: '',
    };
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    jest.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers sales owner option for admin import defaults', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', level: 1 },
        { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: 'SALES', level: 3 },
      ],
    });

    const setImportOwnerId = jest.fn((value: string | ((prev: string) => string)) => {
      importOwnerId = typeof value === 'function' ? value(importOwnerId) : value;
    });
    const setForm = jest.fn((value: CustomerFormState | ((prev: CustomerFormState) => CustomerFormState)) => {
      formState = typeof value === 'function' ? value(formState) : value;
    });

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId,
      editing: null,
      fixingTarget: null,
      form: formState,
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.loadOwnerOptions();
    });

    expect(setOwnerOptions).toHaveBeenCalled();
    expect(importOwnerId).toBe('sales-1');
    expect(formState.ownerId).toBe('sales-1');
  });

  it('creates customer and refreshes list on success', async () => {
    mockApiCall.mockResolvedValueOnce({ success: true, data: { id: 'cust-1' } });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
      editing: null,
      fixingTarget: null,
      form: { ...formState, ownerId: 'sales-1' },
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.handleCreateOrUpdate();
    });

    expect(mockApiCall).toHaveBeenCalledWith('customer', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        mark: 'MAB-1',
        orderName: 'MAB-1',
        name: 'Customer',
        phone: '620000001',
        city: 'Conakry',
        consignee: '',
        companyName: null,
        companyAddress: null,
        credit: null,
        ownerId: 'sales-1',
      }),
    }));
    expect(setShowCreate).toHaveBeenCalledWith(false);
    expect(setEditing).toHaveBeenCalledWith(null);
    expect(resetForm).toHaveBeenCalled();
    expect(loadCustomers).toHaveBeenCalled();
  });

  it('shows alert when create fails', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '保存失败' });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: false,
      defaultOwnerId: 'sales-1',
      importOwnerId: '',
      editing: null,
      fixingTarget: null,
      form: { ...formState, ownerId: '' },
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.handleCreateOrUpdate();
    });

    expect(window.alert).toHaveBeenCalledWith('保存失败');
    expect(loadCustomers).not.toHaveBeenCalled();
  });

  it('uses default owner for non-admin owner options', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: 'SALES', level: 3 }],
    });

    const setImportOwnerId = jest.fn((value: string | ((prev: string) => string)) => {
      importOwnerId = typeof value === 'function' ? value(importOwnerId) : value;
    });
    const setForm = jest.fn((value: CustomerFormState | ((prev: CustomerFormState) => CustomerFormState)) => {
      formState = typeof value === 'function' ? value(formState) : value;
    });

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: false,
      defaultOwnerId: 'sales-1',
      importOwnerId,
      editing: null,
      fixingTarget: null,
      form: formState,
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.loadOwnerOptions();
    });

    expect(importOwnerId).toBe('sales-1');
    expect(formState.ownerId).toBe('sales-1');
  });

  it('deletes customer after confirmation and refreshes list', async () => {
    mockApiCall.mockResolvedValueOnce({ success: true });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
      editing: null,
      fixingTarget: null,
      form: { ...formState, ownerId: 'sales-1' },
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.handleDelete('cust-1');
    });

    expect(mockApiCall).toHaveBeenCalledWith('customer', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id: 'cust-1' }),
    });
    expect(loadCustomers).toHaveBeenCalled();
  });

  it('submits customer fix and refreshes both lists', async () => {
    mockApiCall.mockResolvedValueOnce({ success: true });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
      editing: null,
      fixingTarget: { type: 'receipt', id: 'receipt-1' },
      form: { ...formState, ownerId: 'sales-1' },
      latestFailedRows: [],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.submitFix();
    });

    expect(mockApiCall).toHaveBeenCalledWith('customer/fixes', expect.objectContaining({
      method: 'POST',
    }));
    const requestBody = JSON.parse(String(mockApiCall.mock.calls[0][1].body));
    expect(requestBody).toEqual(expect.objectContaining({
      action: 'resolve-receipt',
      receiptId: 'receipt-1',
      ownerId: 'sales-1',
    }));
    expect(setFixingTarget).toHaveBeenCalledWith(null);
    expect(resetForm).toHaveBeenCalled();
    expect(loadCustomers).toHaveBeenCalled();
    expect(loadFixes).toHaveBeenCalled();
  });

  it('retries failed import rows and updates import message', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'retry ok',
        rowResults: [
          {
            rowNo: 8,
            mark: 'FIX-1',
            orderName: 'FIX-ORDER',
            name: 'Fix User',
            phone: '620999999',
            city: 'Conakry',
            consignee: '',
            companyName: '',
            credit: '',
            companyAddress: '',
            ownerEmail: 'sales@example.com',
            status: 'CREATED',
            reason: '',
          },
        ],
      }),
    } as Response);
    globalThis.fetch = fetchSpy as typeof fetch;

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
      editing: null,
      fixingTarget: null,
      form: { ...formState, ownerId: 'sales-1' },
      latestFailedRows: [
        {
          rowNo: 8,
          mark: 'FIX-1',
          orderName: 'FIX-ORDER',
          name: 'Fix User',
          phone: '620999999',
          city: 'Conakry',
          consignee: '',
          companyName: '',
          credit: '',
          companyAddress: '',
          ownerEmail: 'sales@example.com',
          latestStatus: 'FAILED',
          latestReason: 'duplicate',
          attempts: [],
        },
      ],
      loadCustomers,
      loadFixes,
      setOwnerOptions,
      setImportOwnerId,
      setForm,
      setShowCreate,
      setEditing,
      setFixingTarget,
      setCustomerImporting,
      setCustomerImportRows,
      setShowCustomerImportIssues,
      setCustomerIssueSubmitting,
      setCustomerImportMessage,
      customerImportInputRef: { current: null },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.retryCustomerIssueRows();
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/customer', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }));
    expect(setCustomerImportRows).toHaveBeenCalled();
    expect(setCustomerImportMessage).toHaveBeenCalledWith('retry ok');
    expect(loadCustomers).toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });
});
