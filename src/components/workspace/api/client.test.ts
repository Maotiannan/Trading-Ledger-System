import {
  apiUploadCall,
  classifyApiUploadError,
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
              customerPhone: '622 49 12 86',
              customerPayer: 'MAB SARL',
              createdAt: '2026-04-27T02:00:00.000Z',
              invoice: { invNo: 'INV-LATEST', createdAt: '2026-04-27T02:00:00.000Z' },
            },
            {
              orderNo: 'TEST-1-05',
              customerMark: 'ASD-DSA',
              customerName: 'TEST-1',
              customerId: 'cust-old',
              customerPhone: '620000000',
              customerPayer: 'Old Payer',
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
      phoneSuggestion: '622 49 12 86',
      payerSuggestion: 'MAB SARL',
      invoiceSuggestion: {
        invNo: 'INV-LATEST',
        conflict: true,
        count: 2,
      },
    });

    Object.assign(global, { fetch: originalFetch });
  });

  it('reports upload progress and saving stage for multipart uploads', async () => {
    const OriginalXHR = global.XMLHttpRequest;
    const progressSpy = jest.fn();
    const stageSpy = jest.fn();

    class MockXHR {
      static instances: MockXHR[] = [];
      readonly uploadListeners = new Map<string, Array<(event?: any) => void>>();
      readonly listeners = new Map<string, Array<(event?: any) => void>>();
      withCredentials = false;
      responseType = '';
      responseText = '';
      status = 200;
      readyState = 0;

      constructor() {
        MockXHR.instances.push(this);
      }

      upload = {
        addEventListener: (type: string, listener: (event?: any) => void) => {
          const rows = this.uploadListeners.get(type) || [];
          rows.push(listener);
          this.uploadListeners.set(type, rows);
        },
      };

      open(_method: string, _url: string) {}

      addEventListener(type: string, listener: (event?: any) => void) {
        const rows = this.listeners.get(type) || [];
        rows.push(listener);
        this.listeners.set(type, rows);
      }

      send(_formData: FormData) {}

      abort() {
        this.dispatch('abort');
      }

      dispatch(type: string, event: any = {}) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }

      dispatchUpload(type: string, event: any = {}) {
        for (const listener of this.uploadListeners.get(type) || []) listener(event);
      }
    }

    Object.assign(global, { XMLHttpRequest: MockXHR });
    const promise = apiUploadCall('upload-image', new FormData(), {
      onUploadProgress: progressSpy,
      onUploadStageChange: stageSpy,
      idleTimeoutMs: 15_000,
      hardTimeoutMs: 120_000,
    });

    const xhr = MockXHR.instances[0];
    xhr.dispatchUpload('loadstart');
    xhr.dispatchUpload('progress', { loaded: 50, total: 100, lengthComputable: true });
    xhr.dispatchUpload('load');
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ success: true, data: { path: '/ok' } });
    xhr.dispatch('load');

    await expect(promise).resolves.toEqual({ success: true, data: { path: '/ok' } });
    expect(progressSpy).toHaveBeenCalledWith({ loaded: 50, total: 100, percent: 50 });
    expect(progressSpy).toHaveBeenLastCalledWith({ loaded: 1, total: 1, percent: 100 });
    expect(stageSpy).toHaveBeenCalledWith('uploading');
    expect(stageSpy).toHaveBeenCalledWith('saving');
    expect(xhr.withCredentials).toBe(true);

    Object.assign(global, { XMLHttpRequest: OriginalXHR });
  });

  it('fails multipart uploads after 15 seconds of idle time with no upload progress', async () => {
    jest.useFakeTimers();
    const OriginalXHR = global.XMLHttpRequest;

    class MockXHR {
      static instances: MockXHR[] = [];
      readonly uploadListeners = new Map<string, Array<(event?: any) => void>>();
      readonly listeners = new Map<string, Array<(event?: any) => void>>();
      withCredentials = false;
      responseType = '';
      responseText = '';
      status = 200;
      readyState = 0;

      constructor() {
        MockXHR.instances.push(this);
      }

      upload = {
        addEventListener: (type: string, listener: (event?: any) => void) => {
          const rows = this.uploadListeners.get(type) || [];
          rows.push(listener);
          this.uploadListeners.set(type, rows);
        },
      };

      open(_method: string, _url: string) {}

      addEventListener(type: string, listener: (event?: any) => void) {
        const rows = this.listeners.get(type) || [];
        rows.push(listener);
        this.listeners.set(type, rows);
      }

      send(_formData: FormData) {}

      abort() {
        this.dispatch('abort');
      }

      dispatch(type: string, event: any = {}) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
    }

    Object.assign(global, { XMLHttpRequest: MockXHR });
    const promise = apiUploadCall('upload-image', new FormData(), {
      idleTimeoutMs: 15_000,
      hardTimeoutMs: 120_000,
    });
    const captured = promise.catch((error) => error);

    const xhr = MockXHR.instances[0];
    xhr.uploadListeners.get('loadstart')?.forEach((listener) => listener({}));

    await jest.advanceTimersByTimeAsync(15_001);

    await expect(captured).resolves.toMatchObject({
      code: 'UPLOAD_IDLE_TIMEOUT',
      message: 'Upload stalled for too long. Check your network and retry.',
    });

    Object.assign(global, { XMLHttpRequest: OriginalXHR });
    jest.useRealTimers();
  });

  it('classifies upload timeout error codes for shared business upload flows', () => {
    expect(classifyApiUploadError(new WorkspaceApiError('timed out', {
      code: 'UPLOAD_IDLE_TIMEOUT',
    }))).toBe('idle-timeout');
    expect(classifyApiUploadError({ code: 'UPLOAD_HARD_TIMEOUT', error: '上传耗时过长，请重试' })).toBe('hard-timeout');
    expect(classifyApiUploadError({ code: 'UPLOAD_ABORTED', error: '上传中断，请在更稳定的网络下重试' })).toBe('aborted');
    expect(classifyApiUploadError(new Error('boom'))).toBe('unknown');
  });
});
