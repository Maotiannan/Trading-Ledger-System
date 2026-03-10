import { act, renderHook } from '@testing-library/react';
import { useCustomerForms } from './use-customer-forms';

describe('useCustomerForms', () => {
  it('fills edit and fix forms from source rows', () => {
    const { result } = renderHook(() => useCustomerForms({
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
    }));

    act(() => {
      result.current.openEdit({
        id: 'cust-1',
        mark: 'MAB-1',
        orderName: 'MAB-1',
        name: 'MAB',
        phone: '620000001',
        city: 'Conakry',
        ownerId: 'sales-1',
      });
    });

    expect(result.current.editing?.id).toBe('cust-1');
    expect(result.current.showCreate).toBe(true);
    expect(result.current.form.mark).toBe('MAB-1');
    expect(result.current.form.ownerId).toBe('sales-1');

    act(() => {
      result.current.openFix('receipt', {
        id: 'receipt-1',
        customerMark: 'FIX-MARK',
        customerName: 'FIX-NAME',
        customerPhone: '620999999',
        customerCity: 'Kankan',
      });
    });

    expect(result.current.fixingTarget).toEqual({ type: 'receipt', id: 'receipt-1' });
    expect(result.current.form.mark).toBe('FIX-MARK');
    expect(result.current.form.orderName).toBe('FIX-NAME');
    expect(result.current.form.phone).toBe('620999999');
  });
});
