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
      phoneSuggestion: '622 49 12 86',
      payerSuggestion: 'MAB SARL',
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
    expect(result.current.directForm.tel).toBe('622 49 12 86');
    expect(result.current.directForm.payer).toBe('MAB SARL');
  });

  it('prefers database inv suggestion over OCR inv when upload dialog has an order match', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'ASD-DSA',
        name: 'TEST-1',
        customerId: 'cust-1',
      },
      phoneSuggestion: '622 49 12 86',
      payerSuggestion: 'MAB SARL',
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
      tel: '622 49 12 86',
      payer: 'MAB SARL',
    }));
    expect(result.current.ocrInvConflict).toBe(false);
    expect(result.current.ocrCustomerMark).toBe('ASD-DSA');
  });

  it('falls back payer suggestion from customer name when company name is empty', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'FALLBACK',
        name: 'Fallback Name',
        customerId: 'cust-9',
      },
      phoneSuggestion: '620000999',
      payerSuggestion: 'Fallback Name',
      invoiceSuggestion: null,
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowDirectCreateChange(true);
    });

    await act(async () => {
      result.current.setDirectForm((prev) => ({ ...prev, orderNo: 'TEST-2-01' }));
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.directForm.customerMark).toBe('FALLBACK');
    expect(result.current.directForm.tel).toBe('620000999');
    expect(result.current.directForm.payer).toBe('Fallback Name');
  });

  it('clears direct-create INV NO when the entered order has no invoice match', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'AB',
        name: 'AB',
        customerId: 'cust-ab',
      },
      phoneSuggestion: '+224 664 51 79 52',
      payerSuggestion: 'Thierno Oumar Barry "AB"',
      invoiceSuggestion: null,
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowDirectCreateChange(true);
    });

    await act(async () => {
      result.current.setDirectForm((prev) => ({
        ...prev,
        orderNo: 'AB-13B',
        invNo: 'L25MH060992C',
      }));
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.directForm.invNo).toBe('');
    expect(result.current.directForm.payer).toBe('Thierno Oumar Barry "AB"');
  });

  it('clears OCR INV NO when the recognized order has no invoice match', async () => {
    mockLookupOrderContextByOrderNo.mockResolvedValue({
      matchedCustomer: {
        mark: 'AB',
        name: 'AB',
        customerId: 'cust-ab',
      },
      phoneSuggestion: '+224 664 51 79 52',
      payerSuggestion: 'Thierno Oumar Barry "AB"',
      invoiceSuggestion: null,
    });

    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowUploadChange(true);
    });

    await act(async () => {
      result.current.setOcrResult({ orderNo: 'AB-13B', invNo: 'L25MH060992C' });
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.ocrResult).toEqual(expect.objectContaining({
      orderNo: 'AB-13B',
      invNo: '',
      payer: 'Thierno Oumar Barry "AB"',
    }));
  });

  it('tracks OCR upload stage state and resets it when the upload dialog closes', async () => {
    const loadCustomerCandidates = jest.fn();
    const { result } = renderHook(() => useReceiptForms(loadCustomerCandidates));

    await act(async () => {
      result.current.handleShowUploadChange(true);
      result.current.setOcrResult({ receiptNo: 'OCR-1' });
      result.current.setOcrUploadStatus('uploading');
      result.current.setOcrUploadMessage('正在上传压缩后的图片（42%）...');
      result.current.setOcrUploadProgress(42);
    });

    expect(result.current.ocrUploadStatus).toBe('uploading');
    expect(result.current.ocrUploadMessage).toBe('正在上传压缩后的图片（42%）...');
    expect(result.current.ocrUploadProgress).toBe(42);

    await act(async () => {
      result.current.handleShowUploadChange(false);
    });

    expect(result.current.ocrResult).toBeNull();
    expect(result.current.ocrUploadStatus).toBe('idle');
    expect(result.current.ocrUploadMessage).toBeNull();
    expect(result.current.ocrUploadProgress).toBeNull();
  });
});
