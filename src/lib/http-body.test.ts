import { assertRequestBodyWithinLimit, parseActionRequest, parseJsonRequest } from '@/lib/http-body';
import type { NextRequest } from 'next/server';

function makeRequest(
  payload: string,
  headers: Record<string, string> = {},
  extra: Partial<Pick<NextRequest, 'formData'>> = {},
) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return payload;
    },
    ...extra,
  } as unknown as NextRequest;
}

describe('http-body', () => {
  it('rejects oversized JSON bodies', async () => {
    const payload = JSON.stringify({
      action: 'login',
      filler: 'x'.repeat(300 * 1024),
    });
    const request = makeRequest(payload, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(payload, 'utf8')),
    });

    await expect(parseJsonRequest(request)).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      status: 413,
    });
  });

  it('rejects invalid JSON payloads as bad requests', async () => {
    const request = makeRequest('{"action": ', {
      'content-type': 'application/json',
    });

    await expect(parseJsonRequest(request)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: '请求体格式错误',
    });
  });

  it('allows empty JSON payloads and returns an empty object', async () => {
    const request = makeRequest('   ', {
      'content-type': 'application/json',
    });

    await expect(parseJsonRequest(request)).resolves.toEqual({});
  });

  it('rejects oversized multipart bodies from declared content length', async () => {
    const request = makeRequest('', {
      'content-type': 'multipart/form-data; boundary=abc',
      'content-length': String(11 * 1024 * 1024),
    });

    await expect(assertRequestBodyWithinLimit(request)).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      status: 413,
    });
  });

  it('parses JSON action requests', async () => {
    const request = makeRequest(JSON.stringify({
      action: 'create',
      id: 'row-1',
    }), {
      'content-type': 'application/json',
    });

    await expect(parseActionRequest(request)).resolves.toEqual({
      action: 'create',
      data: {
        action: 'create',
        id: 'row-1',
      },
    });
  });

  it('parses multipart action requests and extracts files', async () => {
    const form = new FormData();
    form.append('action', 'recognize');
    form.append('customerMark', 'ABC');
    form.append('file', new File(['hello'], 'demo.txt', { type: 'text/plain' }));
    const request = makeRequest('', {
      'content-type': 'multipart/form-data; boundary=abc',
    }, {
      async formData() {
        return form;
      },
    });

    const parsed = await parseActionRequest(request);
    expect(parsed.action).toBe('recognize');
    expect(parsed.data).toEqual({
      action: 'recognize',
      customerMark: 'ABC',
    });
    expect(parsed.file).toBeInstanceOf(File);
  });

  it('falls back from invalid JSON to form data', async () => {
    const form = new FormData();
    form.append('action', 'fallback');
    form.append('receiptNo', 'R-1');
    const request = makeRequest('{invalid', {}, {
      async formData() {
        return form;
      },
    });

    await expect(parseActionRequest(request)).resolves.toEqual({
      action: 'fallback',
      data: {
        action: 'fallback',
        receiptNo: 'R-1',
      },
      file: undefined,
    });
  });

  it('returns an empty action payload when neither JSON nor form data can be parsed', async () => {
    const request = makeRequest('{invalid', {}, {
      async formData() {
        throw new Error('bad form');
      },
    });

    await expect(parseActionRequest(request)).resolves.toEqual({
      action: '',
      data: {},
    });
  });
});
