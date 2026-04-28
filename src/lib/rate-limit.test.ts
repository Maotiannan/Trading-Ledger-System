import { enforceRateLimit, resetRateLimitStore } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';

jest.mock('@/lib/system-settings', () => ({
  getNumericSystemSetting: jest.fn(async (key: string, fallback: number) => {
    if (String(key).includes('WINDOW_MS')) return 60_000;
    if (String(key).includes('MAX')) return 2;
    return fallback;
  }),
}));

function makeRequest() {
  return {
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'x-forwarded-for') {
          return '127.0.0.1';
        }
        if (name.toLowerCase() === 'x-real-ip') {
          return '10.0.0.2';
        }
        return null;
      },
    },
  } as unknown as NextRequest;
}

describe('rate-limit', () => {
  beforeEach(() => {
    resetRateLimitStore();
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
});
