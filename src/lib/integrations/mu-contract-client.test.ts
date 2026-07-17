/** @jest-environment node */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createMuContractClient,
  MuContractClientError,
} from '@/lib/integrations/mu-contract-client';

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

function mockFetch(
  implementation?: (url: string, init?: RequestInit) => Promise<Response>,
): FetchMock {
  return jest.fn<Promise<Response>, [string, RequestInit?]>(implementation);
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    path.join(process.cwd(), 'tests', 'fixtures', 'mu-contract-order-sync', name),
    'utf8',
  ));
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MU Contract HTTP client', () => {
  it('uses the dedicated bearer token and exact event cursor query', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(fixture('formal-generated.json')));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test/',
      token: 'dedicated-secret',
      fetchImpl,
    });

    await expect(client.fetchEvents('1041', 100)).resolves.toEqual(
      expect.objectContaining({ schemaVersion: 1, nextCursor: '1042' }),
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://contract.example.test/integrations/muledger/order-events?after=1041&limit=100',
    );
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer dedicated-secret');
    expect(init?.cache).toBe('no-store');
  });

  it('reads snapshot pages and obtains their event high-watermark', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(fixture('deactivated.json')));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
    });

    await expect(client.fetchSnapshot('deleted-pi-id', 25)).resolves.toEqual(
      expect.objectContaining({ schemaVersion: 1, eventHighWatermark: '1042' }),
    );
    await expect(client.fetchSnapshotHighWatermark()).resolves.toBe('1042');

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://contract.example.test/integrations/muledger/order-snapshot?after=deleted-pi-id&limit=25',
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://contract.example.test/integrations/muledger/order-snapshot?limit=1',
    );
  });

  it('retries retryable source responses and succeeds without exposing the body', async () => {
    const fetchImpl = mockFetch()
      .mockResolvedValueOnce(new Response('internal details', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(fixture('formal-generated.json')));
    const sleep = jest.fn(async () => undefined);
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
      sleep,
    });

    await expect(client.fetchEvents(null, 100)).resolves.toEqual(
      expect.objectContaining({ schemaVersion: 1 }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('never retries authentication failures or leaks credentials and response text', async () => {
    const fetchImpl = mockFetch(async () => (
      new Response('upstream-secret-body', { status: 401 })
    ));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
    });

    let thrown: unknown;
    try {
      await client.fetchEvents(null, 100);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MuContractClientError);
    expect(thrown).toMatchObject({ code: 'MU_CONTRACT_HTTP_AUTH_FAILED', status: 401 });
    expect(String(thrown)).not.toContain('dedicated-secret');
    expect(String(thrown)).not.toContain('upstream-secret-body');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds network retries to three attempts and returns a safe error', async () => {
    const fetchImpl = mockFetch(async () => {
      throw new TypeError('network diagnostics containing dedicated-secret');
    });
    const sleep = jest.fn(async () => undefined);
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
      sleep,
    });

    await expect(client.fetchEvents(null, 100)).rejects.toMatchObject({
      code: 'MU_CONTRACT_NETWORK_ERROR',
      status: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled request at the configured timeout', async () => {
    const fetchImpl = mockFetch((_url, init) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('request aborted', 'AbortError'));
        });
      })
    ));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
      timeoutMs: 5,
      maxAttempts: 1,
    });

    await expect(client.fetchEvents(null, 100)).rejects.toMatchObject({
      code: 'MU_CONTRACT_REQUEST_TIMEOUT',
    });
  });

  it('rejects oversized responses before parsing and does not retry them', async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(fixture('formal-generated.json')));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
      maxResponseBytes: 32,
    });

    await expect(client.fetchEvents(null, 100)).rejects.toMatchObject({
      code: 'MU_CONTRACT_RESPONSE_TOO_LARGE',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry malformed contract payloads', async () => {
    const fetchImpl = mockFetch(async () => (
      jsonResponse({ schemaVersion: 1, events: [] })
    ));
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: 'dedicated-secret',
      fetchImpl,
    });

    await expect(client.fetchEvents(null, 100)).rejects.toMatchObject({
      code: 'MU_CONTRACT_PAYLOAD_INVALID',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('validates configuration and page bounds before any request', async () => {
    const fetchImpl = mockFetch();
    const client = createMuContractClient({
      baseUrl: 'https://contract.example.test',
      token: '',
      fetchImpl,
    });

    await expect(client.fetchEvents(null, 0)).rejects.toMatchObject({
      code: 'MU_CONTRACT_REQUEST_INVALID',
    });
    await expect(client.fetchEvents(null, 501)).rejects.toMatchObject({
      code: 'MU_CONTRACT_REQUEST_INVALID',
    });
    await expect(client.fetchEvents(null, 100)).rejects.toMatchObject({
      code: 'MU_CONTRACT_CONFIG_INVALID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
