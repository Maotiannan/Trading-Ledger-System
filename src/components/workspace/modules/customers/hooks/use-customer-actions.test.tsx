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

  it('keeps owner options unchanged when owner option load fails', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '读取失败' });

    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

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

    expect(setOwnerOptions).not.toHaveBeenCalled();
    expect(setImportOwnerId).not.toHaveBeenCalled();
    expect(setForm).not.toHaveBeenCalled();
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

  it('shows alert when create request throws', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('保存失败'));
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

  it('alerts after save when server reports a phone conflict warning', async () => {
    mockApiCall.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'cust-1',
        phoneConflict: true,
        phoneConflictMessage: '手机号冲突，请修改',
      },
      message: '客户已更新',
    });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: '',
      editing: { id: 'cust-1' },
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

    expect(loadCustomers).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('手机号冲突，请修改');
  });

  it('updates customer with default owner fallback for admin', async () => {
    mockApiCall.mockResolvedValueOnce({ success: true, data: { id: 'cust-1' } });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: '',
      editing: { id: 'cust-1' },
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

    expect(mockApiCall).toHaveBeenCalledWith('customer', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'update',
        id: 'cust-1',
        mark: 'MAB-1',
        orderName: 'MAB-1',
        name: 'Customer',
        phone: '620000001',
        city: 'Conakry',
        consignee: '',
        companyName: null,
        companyAddress: null,
        credit: null,
        ownerId: 'admin-1',
      }),
    }));
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

  it('alerts when delete fails', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '删除失败' });
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

    expect(window.alert).toHaveBeenCalledWith('删除失败');
    expect(loadCustomers).not.toHaveBeenCalled();
  });

  it('skips delete for non-admin users', async () => {
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
      await result.current.handleDelete('cust-1');
    });

    expect(window.confirm).not.toHaveBeenCalled();
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('stops delete when confirmation is cancelled', async () => {
    jest.spyOn(window, 'confirm').mockImplementation(() => false);
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

    expect(window.confirm).toHaveBeenCalled();
    expect(mockApiCall).not.toHaveBeenCalled();
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

  it('alerts when customer fix fails', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '修复失败' });
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();

    const { result } = renderHook(() => useCustomerActions({
      tx,
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
      editing: null,
      fixingTarget: { type: 'order', id: 'order-1' },
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

    expect(window.alert).toHaveBeenCalledWith('修复失败');
    expect(loadCustomers).not.toHaveBeenCalled();
    expect(loadFixes).not.toHaveBeenCalled();
  });

  it('returns early when no fixing target exists', async () => {
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
      await result.current.submitFix();
    });

    expect(mockApiCall).not.toHaveBeenCalled();
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

  it('imports customer excel from issue row fallback results', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const input = document.createElement('input');
    input.value = 'pending.xlsx';
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: 'import ok',
        issueRows: [
          {
            rowNo: 3,
            mark: 'IB',
            orderName: 'IB',
            name: 'Ibrahima',
            phone: '622443103',
            city: 'Conakry',
            status: 'FAILED',
            reason: 'duplicate',
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
      customerImportInputRef: { current: input },
      resetForm,
      resetImportTable,
    }));

    await act(async () => {
      await result.current.handleCustomerExcelImport(new File(['rows'], 'customers.xlsx'));
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(setCustomerImportRows).toHaveBeenCalled();
    expect(setShowCustomerImportIssues).toHaveBeenCalledWith(true);
    expect(setCustomerImportMessage).toHaveBeenCalledWith('import ok');
    expect(input.value).toBe('');
    globalThis.fetch = originalFetch;
  });

  it('alerts when customer excel import returns only error details', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: '导入失败',
        details: ['第2行重复', '第3行格式错误'],
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
      await result.current.handleCustomerExcelImport(new File(['rows'], 'customers.xlsx'));
    });

    expect(window.alert).toHaveBeenCalledWith('导入失败\n第2行重复\n第3行格式错误');
    globalThis.fetch = originalFetch;
  });

  it('alerts when customer excel import produces no usable row results', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: '导入失败',
        details: ['没有可导入数据'],
        rowResults: [],
        issueRows: [],
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
      await result.current.handleCustomerExcelImport(new File(['rows'], 'customers.xlsx'));
    });

    expect(window.alert).toHaveBeenCalledWith('导入失败\n没有可导入数据');
    globalThis.fetch = originalFetch;
  });

  it('alerts when template download response is not ok', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
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
      await result.current.downloadCustomerImportTemplate();
    });

    expect(mockGetApiResponseErrorMessage).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('模板下载失败');
    globalThis.fetch = originalFetch;
  });

  it('alerts when retry response returns only error details', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: '导入失败',
        details: ['第8行重复'],
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

    expect(window.alert).toHaveBeenCalledWith('导入失败\n第8行重复');
    globalThis.fetch = originalFetch;
  });

  it('alerts when retry produces no usable row results', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: '导入失败',
        details: ['仍然没有可导入数据'],
        rowResults: [],
        issueRows: [],
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

    expect(window.alert).toHaveBeenCalledWith('导入失败\n仍然没有可导入数据');
    globalThis.fetch = originalFetch;
  });

  it('downloads customer template on success', async () => {
    const setImportOwnerId = jest.fn();
    const setForm = jest.fn();
    const originalFetch = globalThis.fetch;
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchor = originalCreateElement('a');
    const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['customer-template']),
    } as Response);
    globalThis.fetch = fetchSpy as typeof fetch;
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'a') return anchor;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:customer-template') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });

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
      await result.current.downloadCustomerImportTemplate();
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/customer?action=import-template', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(anchor.download).toBe('customer-import-template.xlsx');
    expect(clickSpy).toHaveBeenCalled();
    globalThis.fetch = originalFetch;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
  });
});
