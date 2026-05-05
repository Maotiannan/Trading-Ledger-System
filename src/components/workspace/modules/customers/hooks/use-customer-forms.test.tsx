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

  it('extracts non-primary order aliases when opening edit', () => {
    const { result } = renderHook(() => useCustomerForms({
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-1',
    }));

    act(() => {
      result.current.openEdit({
        id: 'cust-2',
        mark: 'SDT 2',
        orderName: 'SUPER DT 2',
        orderNames: [
          { orderName: 'SUPER DT 2', isPrimary: true },
          { orderName: 'SUPERDT2', isPrimary: false },
          { orderName: 'S D T 2', isPrimary: false },
          null,
        ],
      });
    });

    expect(result.current.form.orderName).toBe('SUPER DT 2');
    expect(result.current.form.orderNames).toEqual(['SUPERDT2', 'S D T 2']);
  });

  it('resets form owner according to admin import ownership and closes import issues dialog', () => {
    const { result } = renderHook(() => useCustomerForms({
      isAdmin: true,
      defaultOwnerId: 'admin-1',
      importOwnerId: 'sales-7',
    }));

    act(() => {
      result.current.setForm((prev) => ({
        ...prev,
        mark: 'TEMP',
        orderNames: ['ALT-1'],
        ownerId: 'someone-else',
      }));
      result.current.setShowCustomerImportIssues(true);
      result.current.setCustomerImportRows([
        {
          rowNo: 9,
          latestStatus: 'FAILED',
          latestReason: 'bad row',
          attempts: [{ status: 'FAILED', reason: 'bad row' }],
          mark: 'TMP',
          orderName: 'TMP-1',
          name: 'Tmp',
          phone: '6200',
          city: 'Conakry',
          consignee: '',
          companyName: '',
          companyAddress: '',
          credit: '',
          ownerEmail: '',
        },
      ]);
      result.current.setCustomerImportMessage('bad row');
    });

    act(() => {
      result.current.resetForm();
      result.current.closeCustomerImportDialog();
    });

    expect(result.current.form.mark).toBe('');
    expect(result.current.form.orderNames).toEqual([]);
    expect(result.current.form.ownerId).toBe('sales-7');
    expect(result.current.showCustomerImportIssues).toBe(false);
    expect(result.current.customerImportRows).toEqual([]);
    expect(result.current.customerImportMessage).toBe('');
  });

  it('resets non-admin owner to default owner and only mutates failed import rows', () => {
    const { result } = renderHook(() => useCustomerForms({
      isAdmin: false,
      defaultOwnerId: 'sales-1',
      importOwnerId: 'admin-1',
    }));

    act(() => {
      result.current.setCustomerImportRows([
        {
          rowNo: 1,
          latestStatus: 'FAILED',
          latestReason: 'retry',
          attempts: [{ status: 'FAILED', reason: 'retry' }],
          mark: 'OLD',
          orderName: 'OLD-1',
          name: 'Old',
          phone: '6201',
          city: 'Coyah',
          consignee: '',
          companyName: '',
          companyAddress: '',
          credit: '',
          ownerEmail: '',
        },
        {
          rowNo: 2,
          latestStatus: 'UPDATED',
          latestReason: '',
          attempts: [{ status: 'UPDATED', reason: '' }],
          mark: 'KEEP',
          orderName: 'KEEP-1',
          name: 'Keep',
          phone: '6202',
          city: 'Kindia',
          consignee: '',
          companyName: '',
          companyAddress: '',
          credit: '',
          ownerEmail: '',
        },
      ]);
    });

    act(() => {
      result.current.updateCustomerImportIssue(1, 'mark', 'NEW');
      result.current.updateCustomerImportIssue(2, 'mark', 'SHOULD-NOT-CHANGE');
      result.current.resetForm();
    });

    expect(result.current.customerImportRows[0].mark).toBe('NEW');
    expect(result.current.customerImportRows[1].mark).toBe('KEEP');
    expect(result.current.form.ownerId).toBe('sales-1');
  });
});
