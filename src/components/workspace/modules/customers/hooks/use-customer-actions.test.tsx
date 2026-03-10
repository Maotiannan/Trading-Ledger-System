import { act, renderHook } from '@testing-library/react';
import { useCustomerActions } from './use-customer-actions';
import type { CustomerFormState } from '../types';
import { apiCall } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    initCustomerImportRowViews: jest.fn(),
    mergeCustomerImportRowViews: jest.fn(),
    toCustomerImportRowResults: jest.fn(),
    toCustomerImportRowResultsFromIssues: jest.fn(),
  };
});

const mockApiCall = apiCall as jest.Mock;

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
});
