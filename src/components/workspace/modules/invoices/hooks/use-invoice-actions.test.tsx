import { act, renderHook } from '@testing-library/react';
import { useInvoiceActions } from './use-invoice-actions';
import { apiCall, getApiResponseErrorMessage, getErrorMessage } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => {
  return {
    apiCall: jest.fn(),
    getApiResponseErrorMessage: jest.fn(async (_response: Response, fallback: string) => fallback),
    getErrorMessage: jest.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
  };
});

const mockApiCall = apiCall as jest.Mock;
const mockGetApiResponseErrorMessage = getApiResponseErrorMessage as jest.Mock;
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
    mockGetApiResponseErrorMessage.mockClear();
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

  it('opens invoice import picker through input ref', () => {
    const clickSpy = jest.fn();
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: { current: { click: clickSpy } as unknown as HTMLInputElement },
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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

    act(() => {
      result.current.openInvoiceImportPicker();
    });

    expect(clickSpy).toHaveBeenCalled();
  });

  it('blocks create when any order row is incomplete', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [{ orderNo: '   ', amount: '1200', customerMark: 'MAB-1', customerName: 'MAB', customerId: '', customerCandidates: [] }],
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

    expect(setFormError).toHaveBeenCalledWith('请填写所有订单的客户单号、金额和MARK');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('surfaces create invoice backend failures', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '创建失败' });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
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

    expect(setFormError).toHaveBeenCalledWith('创建失败');
    expect(handleCreateDialogOpenChange).not.toHaveBeenCalled();
    expect(loadInvoices).not.toHaveBeenCalled();
  });

  it('surfaces create invoice request errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('网络错误'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
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

    expect(setFormError).toHaveBeenCalledWith('网络错误');
    consoleSpy.mockRestore();
  });

  it('updates order and refreshes invoices on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: 'INV-001',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(mockApiCall).toHaveBeenCalledWith('invoice', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        action: 'updateOrder',
        orderId: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: 'INV-001',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerPhone: null,
        customerCity: null,
        customerId: 'cust-1',
      }),
    }));
    expect(handleOrderDialogOpenChange).toHaveBeenCalledWith(false);
    expect(loadInvoices).toHaveBeenCalled();
  });

  it('returns early when update is triggered without an editing order', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.handleUpdateOrder();
    });

    expect(mockApiCall).not.toHaveBeenCalled();
    expect(setOrderFormError).not.toHaveBeenCalled();
  });

  it('blocks order update when order number is empty', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: '   ',
        invNo: 'INV-001',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(setOrderFormError).toHaveBeenCalledWith('请输入客户单号');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('blocks order update when invoice number is empty', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: '   ',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(setOrderFormError).toHaveBeenCalledWith('请输入账单号');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('surfaces order update backend failures', async () => {
    mockApiCall.mockResolvedValueOnce({ success: false, error: '修改失败' });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: 'INV-001',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(setOrderFormError).toHaveBeenCalledWith('修改失败');
    expect(handleOrderDialogOpenChange).not.toHaveBeenCalled();
    expect(loadInvoices).not.toHaveBeenCalled();
  });

  it('surfaces order update request errors', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('更新网络错误'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: 'INV-001',
        amount: 500,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(setOrderFormError).toHaveBeenCalledWith('更新网络错误');
    consoleSpy.mockRestore();
  });

  it('blocks order update when amount is invalid', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: {
        id: 'order-1',
        orderNo: 'MAB-1-02',
        invNo: 'INV-001',
        amount: -1,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      },
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
      await result.current.handleUpdateOrder();
    });

    expect(setOrderFormError).toHaveBeenCalledWith('请输入有效金额(>=0)');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('alerts when delete request throws', async () => {
    mockApiCall.mockRejectedValueOnce(new Error('删除网络错误'));
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.handleDeleteOrder('order-2');
    });

    expect(window.alert).toHaveBeenCalledWith('删除网络错误');
    confirmSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('handles delete failure with alert message', async () => {
    mockApiCall.mockResolvedValue({ success: false, error: '删除失败' });
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.handleDeleteOrder('order-2');
    });

    expect(window.alert).toHaveBeenCalledWith('删除失败');
    expect(loadInvoices).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('deletes order and refreshes invoices on success', async () => {
    mockApiCall.mockResolvedValue({ success: true });
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => true);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.handleDeleteOrder('order-2');
    });

    expect(mockApiCall).toHaveBeenCalledWith('invoice', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        action: 'deleteOrder',
        orderId: 'order-2',
      }),
    }));
    expect(loadInvoices).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('skips delete request when user cancels confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockImplementation(() => false);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.handleDeleteOrder('order-2');
    });

    expect(mockApiCall).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('adds order and resets inline form on success', async () => {
    const resetAddOrderForm = jest.fn();
    mockApiCall.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '300',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm,
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(mockApiCall).toHaveBeenCalledWith('invoice', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        action: 'addOrder',
        invoiceId: 'inv-1',
        orderNo: 'MAB-1-03',
        amount: 300,
        customerMark: 'MAB-1',
        customerName: 'MAB',
        customerId: 'cust-1',
      }),
    }));
    expect(resetAddOrderForm).toHaveBeenCalled();
    expect(loadInvoices).toHaveBeenCalled();
  });

  it('returns early when add order is triggered without invoice target', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: null,
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '300',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm: jest.fn(),
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(mockApiCall).not.toHaveBeenCalled();
    expect(setAddError).not.toHaveBeenCalled();
  });

  it('blocks add order when order number is missing', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: '   ',
      newOrderAmount: '300',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm: jest.fn(),
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(setAddError).toHaveBeenCalledWith('请输入客户单号');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('blocks add order when amount is invalid', async () => {
    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '0',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm: jest.fn(),
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(setAddError).toHaveBeenCalledWith('请输入有效金额');
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('surfaces add order failures from backend response', async () => {
    const resetAddOrderForm = jest.fn();
    mockApiCall.mockResolvedValue({ success: false, error: '添加失败' });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '300',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm,
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(setAddError).toHaveBeenCalledWith('添加失败');
    expect(resetAddOrderForm).not.toHaveBeenCalled();
    expect(loadInvoices).not.toHaveBeenCalled();
  });

  it('surfaces add order request errors', async () => {
    const resetAddOrderForm = jest.fn();
    mockApiCall.mockRejectedValueOnce(new Error('添加网络错误'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '300',
      newOrderCustomerMark: 'MAB-1',
      newOrderCustomerName: 'MAB',
      newOrderCustomerId: 'cust-1',
      resetAddOrderForm,
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(setAddError).toHaveBeenCalledWith('添加网络错误');
    expect(resetAddOrderForm).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('blocks add order when customer mark is missing', async () => {
    const resetAddOrderForm = jest.fn();

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
      setFormError,
      handleCreateDialogOpenChange,
      resetCreateInvoiceDialog,
      editingOrder: null,
      setOrderFormError,
      handleOrderDialogOpenChange,
      addingOrderToInvoice: 'inv-1',
      setAddError,
      newOrderNo: 'MAB-1-03',
      newOrderAmount: '300',
      newOrderCustomerMark: '',
      newOrderCustomerName: '',
      newOrderCustomerId: '',
      resetAddOrderForm,
    }));

    await act(async () => {
      await result.current.handleAddOrder();
    });

    expect(setAddError).toHaveBeenCalledWith('请输入客户MARK');
    expect(mockApiCall).not.toHaveBeenCalled();
    expect(resetAddOrderForm).not.toHaveBeenCalled();
  });

  it('alerts when template download fails', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.downloadInvoiceImportTemplate();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/invoice?action=import-template', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(window.alert).toHaveBeenCalledWith('模板下载失败');
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: originalFetch });
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it('downloads invoice template on success', async () => {
    const originalFetch = globalThis.fetch;
    const originalCreateElement = document.createElement.bind(document);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const anchor = originalCreateElement('a');
    const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => undefined);
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['invoice-template'])),
    } as unknown as Response);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'a') return anchor;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: jest.fn(() => 'blob:invoice-template') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: jest.fn() });

    const { result } = renderHook(() => useInvoiceActions({
      tx,
      invoiceImportInputRef: inputRef,
      loadInvoices,
      invNo: 'INV-001',
      shipDate: '',
      releaseDate: '',
      orders: [],
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
      await result.current.downloadInvoiceImportTemplate();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/invoice?action=import-template', expect.objectContaining({
      method: 'GET',
      credentials: 'include',
    }));
    expect(anchor.download).toBe('invoice-import-template.xlsx');
    expect(clickSpy).toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: originalCreateObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: originalRevokeObjectURL });
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: originalFetch });
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });
});
