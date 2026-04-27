'use client';

import { act, renderHook } from '@testing-library/react';
import { useReceiptForms } from './use-receipt-forms';
import { fetchServerDate, lookupOrderContextByOrderNo } from '@/components/workspace/shared';

jest.mock('@/components/workspace/shared', () => ({
  fetchServerDate: jest.fn(),
  lookupOrderContextByOrderNo: jest.fn(),
}));

const mockFetchServerDate = fetchServerDate as jest.Mock;
const mockLookupOrderContextByOrderNo = lookupOrderContextByOrderNo as jest.Mock;

describe('useReceiptForms', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFetchServerDate.mockResolvedValue('2026-04-27');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fills direct-create inv suggestion from database and flags multi-invoice conflicts', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'ASD-DSA',
        name: 'TEST-1',
        customerId: 'cust-1',
      },
      invoiceSuggestion: {
        invNo: 'INV-LATEST',
        conflict: true,
        count: 2,
      },
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowDirectCreateChange(true);
    });

    await act(async () => {
      result.current.setDirectForm((prev) => ({ ...prev, orderNo: 'TEST-1-05' }));
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.directForm.invNo).toBe('INV-LATEST');
    expect(result.current.directInvConflict).toBe(true);
    expect(result.current.directInvConflictCount).toBe(2);
    expect(result.current.directForm.customerMark).toBe('ASD-DSA');
  });

  it('prefers database inv suggestion over OCR inv when upload dialog has an order match', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'ASD-DSA',
        name: 'TEST-1',
        customerId: 'cust-1',
      },
      invoiceSuggestion: {
        invNo: 'INV-DB',
        conflict: false,
        count: 1,
      },
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowUploadChange(true);
    });

    await act(async () => {
      result.current.setOcrResult({ orderNo: 'TEST-1-05', invNo: 'OCR-INV' });
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.ocrResult).toEqual(expect.objectContaining({
      orderNo: 'TEST-1-05',
      invNo: 'INV-DB',
    }));
    expect(result.current.ocrInvConflict).toBe(false);
    expect(result.current.ocrCustomerMark).toBe('ASD-DSA');
  });
});
