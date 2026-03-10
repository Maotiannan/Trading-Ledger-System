import { act, renderHook } from '@testing-library/react';
import { useInvoiceActions } from './use-invoice-actions';
import { apiCall, getErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
  };
});

const mockApiCall = apiCall as jest.Mock;
const mockGetErrorMessage = getErrorMessage as jest.Mock;

describe('useInvoiceActions', () => {
  const tx = (zh: string, _en: string) => zh;
  const loadInvoices = jest.fn(async () => undefined);
  const inputRef = { current: null };
  const setFormError = jest.fn();
  const handleCreateDialogOpenChange = jest.fn();
  const resetCreateInvoiceDialog = jest.fn();
  const setOrderFormError = jest.fn();
  const handleOrderDialogOpenChange = jest.fn();
  const setAddError = jest.fn();
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockApiCall.mockReset();
    mockGetErrorMessage.mockClear();
    loadInvoices.mockClear();
    setFormError.mockClear();
    handleCreateDialogOpenChange.mockClear();
    resetCreateInvoiceDialog.mockClear();
    setOrderFormError.mockClear();
    handleOrderDialogOpenChange.mockClear();
    setAddError.mockClear();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('blocks create when invoice number is empty', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: '   ',
      shipDate: '',
      releaseDate: '',
      orders: [{ orderNo: 'MAB-1-01', amount: '1200', customerMark: 'MAB-1', customerName: 'MAB', customerId: '', customerCandidates: [] }],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: null,
      setAddError,
      newOrderNo: '',
      newOrderAmount: '',
      newOrderCustomerMark: '',
      newOrderCustomerName: '',
      newOrderCustomerId: '',
      resetAddOrderForm: jest.fn(),
    }));

    await act(async () => {
      await result.current.handleCreateInvoice();
    });

    expect(setFormError).toHaveBeenCalledWith('请输入账单号');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('creates invoice and refreshes list on success', async () => {
    mockApiCall.mockResolvedValue({ success: true, message: 'created' });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '2026-03-10',
      releaseDate: '2026-03-11',
      orders: [{ orderNo: 'MAB-1-01', amount: '1200', customerMark: 'MAB-1', customerName: 'MAB', customerId: 'cust-1', customerCandidates: [] }],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: null,
      setAddError,
      newOrderNo: '',
      newOrderAmount: '',
      newOrderCustomerMark: '',
      newOrderCustomerName: '',
      newOrderCustomerId: '',
      resetAddOrderForm: jest.fn(),
    }));

    await act(async () => {
      await result.current.handleCreateInvoice();
    });

    expect(mockApiCall).toHaveBeenCalledWith('invoice', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        invNo: 'INV-001',
        shipDate: '2026-03-10',
        releaseDate: '2026-03-11',
        orders: [{ orderNo: 'MAB-1-01', amount: 1200, customerMark: 'MAB-1', customerName: 'MAB', customerId: 'cust-1' }],
      }),
    }));
    expect(handleCreateDialogOpenChange).toHaveBeenCalledWith(false);
    expect(resetCreateInvoiceDialog).toHaveBeenCalled();
    expect(loadInvoices).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('created');
  });
});
