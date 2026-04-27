import {
  getApiErrorCode,
  getApiErrorMessage,
  lookupOrderContextByOrderNo,
  peekPrefetchedApiResult,
  prefetchApiResult,
  WorkspaceApiError,
} from '@/components/workspace/api/client';

describe('workspace api client', () => {
  let originalLang = 'zh';

  beforeEach(() => {
    originalLang = document.documentElement.lang;
    document.documentElement.lang = 'en';
  });

  afterEach(() => {
    document.documentElement.lang = originalLang;
  });

  it('translates generic coded messages for english locale', () => {
    const message = getApiErrorMessage(
      { code: 'FORBIDDEN', error: '无权限' },
      'fallback',
    );

    expect(message).toBe('Permission denied');
    expect(getApiErrorCode({ code: 'FORBIDDEN', error: '无权限' })).toBe('FORBIDDEN');
  });

  it('translates auth-specific error codes', () => {
    const message = getApiErrorMessage(
      { code: 'INVALID_CREDENTIALS', error: '邮箱或密码错误' },
      'fallback',
    );

    expect(message).toBe('Invalid email or password');
  });

  it('preserves specific server-side messages instead of collapsing them to generic code text', () => {
    const message = getApiErrorMessage(
      { code: 'BAD_REQUEST', error: 'SWIFT reject tolerance cannot be lower than warning tolerance' },
      'fallback',
    );

    expect(message).toBe('SWIFT reject tolerance cannot be lower than warning tolerance');
  });

  it('appends detail text when requested', () => {
    const message = getApiErrorMessage(
      { code: 'BAD_REQUEST', error: '参数错误', detail: 'field=OCR_DISABLED' },
      'fallback',
      { appendDetail: true },
    );

    expect(message).toBe('Invalid request | field=OCR_DISABLED');
  });

  it('reads WorkspaceApiError instances directly', () => {
    const error = new WorkspaceApiError('Conflict detected', {
      code: 'CONFLICT',
      detail: { key: 'value' },
      status: 409,
    });

    expect(getApiErrorMessage(error, 'fallback')).toBe('Conflict detected');
    expect(getApiErrorCode(error)).toBe('CONFLICT');
  });

  it('falls back to translated raw message when no code exists', () => {
    expect(getApiErrorMessage({ error: '请上传Excel文件' }, 'fallback')).toBe('Please upload an Excel file');
  });

  it('prefetches and reuses cached GET responses', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [{ id: 'row-1' }] }),
    } as Response);
    Object.assign(global, { fetch: fetchMock });

    const first = await prefetchApiResult('prefetch-smoke');
    const cached = peekPrefetchedApiResult<{ success: boolean; data: Array<{ id: string }> }>('prefetch-smoke');
    const second = await prefetchApiResult('prefetch-smoke');

    expect(first).toEqual({ success: true, data: [{ id: 'row-1' }] });
    expect(cached).toEqual({ success: true, data: [{ id: 'row-1' }] });
    expect(second).toEqual({ success: true, data: [{ id: 'row-1' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.assign(global, { fetch: originalFetch });
  });

  it('prefers exact database invoice context and marks multi-invoice conflicts', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          exactMatches: [
            {
              orderNo: 'TEST-1-05',
              customerMark: 'ASD-DSA',
              customerName: 'TEST-1',
              customerId: 'cust-latest',
              createdAt: '2026-04-27T02:00:00.000Z',
              invoice: { invNo: 'INV-LATEST', createdAt: '2026-04-27T02:00:00.000Z' },
            },
            {
              orderNo: 'TEST-1-05',
              customerMark: 'ASD-DSA',
              customerName: 'TEST-1',
              customerId: 'cust-old',
              createdAt: '2026-04-26T02:00:00.000Z',
              invoice: { invNo: 'INV-OLD', createdAt: '2026-04-26T02:00:00.000Z' },
            },
          ],
          inferredCustomer: {
            id: 'cust-fallback',
            mark: 'FALLBACK',
            orderName: 'TEST-1',
            name: 'Fallback',
          },
        },
      }),
    } as Response);
    Object.assign(global, { fetch: fetchMock });

    const result = await lookupOrderContextByOrderNo('TEST-1-05');

    expect(result).toEqual({
      matchedCustomer: {
        mark: 'ASD-DSA',
        name: 'TEST-1',
        customerId: 'cust-latest',
      },
      invoiceSuggestion: {
        invNo: 'INV-LATEST',
        conflict: true,
        count: 2,
      },
    });

    Object.assign(global, { fetch: originalFetch });
  });
});
