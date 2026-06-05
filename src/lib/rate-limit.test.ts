import { enforceRateLimit, getClientIp, getRateLimitStoreSizeForDiagnostics, resetRateLimitStore } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';

jest.mock('@/lib/system-settings', () => ({
  getNumericSystemSetting: jest.fn(async (key: string, fallback: number) => {
    if (String(key).includes('WINDOW_MS')) return 60_000;
    if (String(key).includes('MAX')) return 2;
    return fallback;
  }),
}));

function makeRequest(overrides: { forwardedFor?: string | null; realIp?: string | null } = {}) {
  return {
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'x-forwarded-for') {
          return Object.prototype.hasOwnProperty.call(overrides, 'forwardedFor')
            ? overrides.forwardedFor ?? null
            : '127.0.0.1';
        }
        if (name.toLowerCase() === 'x-real-ip') {
          return Object.prototype.hasOwnProperty.call(overrides, 'realIp')
            ? overrides.realIp ?? null
            : '10.0.0.2';
        }
        return null;
      },
    },
  } as unknown as NextRequest;
}

describe('rate-limit', () => {
  const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;

  beforeEach(() => {
    resetRateLimitStore();
    process.env.TRUST_PROXY_HEADERS = 'false';
  });

  afterEach(() => {
    process.env.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    jest.useRealTimers();
  });

  it('allows requests below the bucket limit', async () => {
    await expect(enforceRateLimit('login', makeRequest(), { identityHint: 'user@example.com' })).resolves.toBeUndefined();
    await expect(enforceRateLimit('login', makeRequest(), { identityHint: 'user@example.com' })).resolves.toBeUndefined();
  });

  it('rejects requests after the bucket limit is exceeded', async () => {
    await enforceRateLimit('login', makeRequest(), { identityHint: 'user@example.com' });
    await enforceRateLimit('login', makeRequest(), { identityHint: 'user@example.com' });

    await expect(enforceRateLimit('login', makeRequest(), { identityHint: 'user@example.com' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });

  it('uses current user identity for authenticated buckets', async () => {
    const currentUser = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: 'ADMIN',
      level: 1,
      parentId: null,
      createdById: null,
    } as const;

    await enforceRateLimit('upload', makeRequest(), { currentUser });
    await enforceRateLimit('upload', makeRequest(), { currentUser });

    await expect(enforceRateLimit('upload', makeRequest(), { currentUser })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });

  it('falls back to the client IP when no user or identity hint is provided', async () => {
    await enforceRateLimit('deletion', makeRequest());
    await enforceRateLimit('deletion', makeRequest());

    await expect(enforceRateLimit('deletion', makeRequest())).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      detail: expect.objectContaining({
        bucket: 'deletion',
      }),
    });
  });

  it('supports the excel lookup bucket for token-authenticated API calls', async () => {
    const currentUser = {
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: 'SALES',
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    } as const;

    await enforceRateLimit('excelLookup', makeRequest(), { currentUser });
    await enforceRateLimit('excelLookup', makeRequest(), { currentUser });

    await expect(enforceRateLimit('excelLookup', makeRequest(), { currentUser })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      detail: expect.objectContaining({
        bucket: 'excelLookup',
      }),
    });
  });

  it('does not let spoofed x-forwarded-for values bypass limits when proxy headers are not trusted', async () => {
    await enforceRateLimit('login', makeRequest({ forwardedFor: '1.1.1.1', realIp: '10.0.0.9' }), { identityHint: 'user@example.com' });
    await enforceRateLimit('login', makeRequest({ forwardedFor: '2.2.2.2', realIp: '10.0.0.9' }), { identityHint: 'user@example.com' });

    await expect(
      enforceRateLimit('login', makeRequest({ forwardedFor: '3.3.3.3', realIp: '10.0.0.9' }), { identityHint: 'user@example.com' })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });

  it('uses the rewritten forwarded IP only when proxy headers are trusted', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';

    expect(getClientIp(makeRequest({ forwardedFor: '8.8.8.8, 9.9.9.9', realIp: '10.0.0.9' }))).toBe('8.8.8.8');
    expect(getClientIp(makeRequest({ forwardedFor: '   ', realIp: null }))).toBe('unknown');
  });

  it('cleans expired keys opportunistically to prevent unbounded memory growth', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-05T00:00:00.000Z'));

    await enforceRateLimit('login', makeRequest({ realIp: '10.0.0.1' }), { identityHint: 'first@example.com' });
    expect(getRateLimitStoreSizeForDiagnostics()).toBe(1);

    jest.setSystemTime(new Date('2026-06-05T00:01:01.000Z'));
    await enforceRateLimit('login', makeRequest({ realIp: '10.0.0.2' }), { identityHint: 'second@example.com' });

    expect(getRateLimitStoreSizeForDiagnostics()).toBe(1);
  });

  it('trims expired timestamps while preserving an active rate-limit key', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-05T00:00:00.000Z'));

    await enforceRateLimit('login', makeRequest({ realIp: '10.0.0.1' }), { identityHint: 'active@example.com' });

    jest.setSystemTime(new Date('2026-06-05T00:00:40.000Z'));
    await enforceRateLimit('login', makeRequest({ realIp: '10.0.0.1' }), { identityHint: 'active@example.com' });

    jest.setSystemTime(new Date('2026-06-05T00:01:01.000Z'));
    await enforceRateLimit('login', makeRequest({ realIp: '10.0.0.2' }), { identityHint: 'other@example.com' });

    expect(getRateLimitStoreSizeForDiagnostics()).toBe(2);
  });
});
