import { createSessionToken } from '@/lib/session';

describe('session secret hardening', () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv.NODE_ENV;
    process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
  });

  it('rejects the public placeholder secret in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'replace-with-a-long-random-secret';

    expect(() => createSessionToken('admin-1')).toThrow(/SESSION_SECRET/i);
  });

  it('allows a non-placeholder production secret with at least 32 chars', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'prod-secret-2026-change-this-value-001';

    expect(createSessionToken('admin-1')).toMatch(/\./);
  });
});
