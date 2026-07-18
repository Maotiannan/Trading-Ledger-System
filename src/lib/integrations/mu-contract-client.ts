import {
  MuContractContractError,
  type MuContractEventPage,
  type MuContractSnapshotPage,
  parseMuContractEventPage,
  parseMuContractSnapshotPage,
} from '@/lib/integrations/mu-contract-contract';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_PAGE_SIZE = 500;

export type MuContractClientErrorCode =
  | 'MU_CONTRACT_CONFIG_INVALID'
  | 'MU_CONTRACT_REQUEST_INVALID'
  | 'MU_CONTRACT_REQUEST_TIMEOUT'
  | 'MU_CONTRACT_NETWORK_ERROR'
  | 'MU_CONTRACT_HTTP_AUTH_FAILED'
  | 'MU_CONTRACT_HTTP_RETRYABLE'
  | 'MU_CONTRACT_HTTP_ERROR'
  | 'MU_CONTRACT_RESPONSE_TOO_LARGE'
  | 'MU_CONTRACT_RESPONSE_INVALID';

export class MuContractClientError extends Error {
  readonly code: MuContractClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: MuContractClientErrorCode,
    options: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(`MU Contract request failed (${code})`);
    this.name = 'MuContractClientError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export type MuContractFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type MuContractClientOptions = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: MuContractFetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  retryBaseDelayMs?: number;
};

export type MuContractClient = {
  fetchEvents(after: string | null, limit: number): Promise<MuContractEventPage>;
  fetchSnapshot(after: string | null, limit: number): Promise<MuContractSnapshotPage>;
  fetchSnapshotHighWatermark(): Promise<string>;
};

type ResolvedClientOptions = {
  baseUrl: URL;
  token: string;
  fetchImpl: MuContractFetch;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  maxAttempts: number;
  maxResponseBytes: number;
  retryBaseDelayMs: number;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function resolveOptions(options: MuContractClientOptions): ResolvedClientOptions {
  const rawBaseUrl = (options.baseUrl ?? process.env.MU_CONTRACT_SYNC_BASE_URL ?? '').trim();
  const token = (options.token ?? process.env.MU_CONTRACT_SYNC_TOKEN ?? '').trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new MuContractClientError('MU_CONTRACT_CONFIG_INVALID');
  }

  if (
    !token
    || !['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username
    || baseUrl.password
    || !isPositiveInteger(timeoutMs)
    || timeoutMs > DEFAULT_TIMEOUT_MS
    || !isPositiveInteger(maxAttempts)
    || maxAttempts > DEFAULT_MAX_ATTEMPTS
    || !isPositiveInteger(maxResponseBytes)
    || !isPositiveInteger(retryBaseDelayMs)
  ) {
    throw new MuContractClientError('MU_CONTRACT_CONFIG_INVALID');
  }

  return {
    baseUrl,
    token,
    fetchImpl: options.fetchImpl ?? fetch,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    timeoutMs,
    maxAttempts,
    maxResponseBytes,
    retryBaseDelayMs,
  };
}

function validatePageInput(after: string | null, limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new MuContractClientError('MU_CONTRACT_REQUEST_INVALID');
  }
  if (after !== null && !after.trim()) {
    throw new MuContractClientError('MU_CONTRACT_REQUEST_INVALID');
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorForStatus(status: number): MuContractClientError {
  if (status === 401 || status === 403) {
    return new MuContractClientError('MU_CONTRACT_HTTP_AUTH_FAILED', { status });
  }
  if (isRetryableStatus(status)) {
    return new MuContractClientError('MU_CONTRACT_HTTP_RETRYABLE', {
      status,
      retryable: true,
    });
  }
  return new MuContractClientError('MU_CONTRACT_HTTP_ERROR', { status });
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new MuContractClientError('MU_CONTRACT_RESPONSE_TOO_LARGE');
  }

  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MuContractClientError('MU_CONTRACT_RESPONSE_TOO_LARGE');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new MuContractClientError('MU_CONTRACT_RESPONSE_INVALID');
  }
}

function normalizeAttemptError(error: unknown, timedOut: boolean): Error {
  if (timedOut || (error instanceof DOMException && error.name === 'AbortError')) {
    return new MuContractClientError('MU_CONTRACT_REQUEST_TIMEOUT', { retryable: true });
  }
  if (error instanceof MuContractClientError || error instanceof MuContractContractError) {
    return error;
  }
  return new MuContractClientError('MU_CONTRACT_NETWORK_ERROR', { retryable: true });
}

function canRetry(error: Error): boolean {
  return error instanceof MuContractClientError && error.retryable;
}

function buildUrl(baseUrl: URL, pathname: string, after: string | null, limit: number): URL {
  const url = new URL(pathname, baseUrl);
  if (after !== null) url.searchParams.set('after', after);
  url.searchParams.set('limit', String(limit));
  return url;
}

export function createMuContractClient(options: MuContractClientOptions = {}): MuContractClient {
  async function request<T>(
    pathname: string,
    after: string | null,
    limit: number,
    parse: (value: unknown) => T,
  ): Promise<T> {
    validatePageInput(after, limit);
    const resolved = resolveOptions(options);
    const url = buildUrl(resolved.baseUrl, pathname, after, limit);

    for (let attempt = 1; attempt <= resolved.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, resolved.timeoutMs);

      try {
        const response = await resolved.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${resolved.token}`,
          },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw errorForStatus(response.status);
        }

        const text = await readBoundedBody(response, resolved.maxResponseBytes);
        return parse(parseJson(text));
      } catch (error) {
        const normalized = normalizeAttemptError(error, timedOut);
        if (attempt >= resolved.maxAttempts || !canRetry(normalized)) throw normalized;
        await resolved.sleep(resolved.retryBaseDelayMs * (2 ** (attempt - 1)));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new MuContractClientError('MU_CONTRACT_NETWORK_ERROR');
  }

  const client: MuContractClient = {
    fetchEvents(after, limit) {
      return request(
        '/integrations/muledger/order-events',
        after,
        limit,
        parseMuContractEventPage,
      );
    },
    fetchSnapshot(after, limit) {
      return request(
        '/integrations/muledger/order-snapshot',
        after,
        limit,
        parseMuContractSnapshotPage,
      );
    },
    async fetchSnapshotHighWatermark() {
      const page = await client.fetchSnapshot(null, 1);
      return page.eventHighWatermark;
    },
  };

  return client;
}
