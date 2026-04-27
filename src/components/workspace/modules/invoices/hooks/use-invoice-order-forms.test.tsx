'use client';

import { act, renderHook } from '@testing-library/react';
import { useInvoiceOrderForms } from './use-invoice-order-forms';
import { lookupOrderContextByOrderNo } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  lookupOrderContextByOrderNo: jest.fn(),
}));

const mockLookupOrderContextByOrderNo = lookupOrderContextByOrderNo as jest.Mock;

describe('useInvoiceOrderForms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fills customer data from exact order context when ORDER is typed in create-invoice form', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'KIGNA TEXTILE',
        name: 'GANDO',
        customerId: 'cust-1',
      },
      invoiceSuggestion: {
        invNo: 'INV-LATEST',
        conflict: false,
        count: 1,
      },
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useInvoiceOrderForms(loadCustomerCandidates));

    await act(async () => {
      result.current.updateOrder(0, 'orderNo', 'GANDO-07');
      await Promise.resolve();
    });

    expect(result.current.orders[0]).toEqual(expect.objectContaining({
      orderNo: 'GANDO-07',
      customerMark: 'KIGNA TEXTILE',
      customerName: 'GANDO',
      customerId: 'cust-1',
    }));
    expect(loadCustomerCandidates).toHaveBeenCalledWith(
      'KIGNA TEXTILE',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });
});
