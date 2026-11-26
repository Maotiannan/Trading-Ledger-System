/** @jest-environment node */
import { NextRequest } from 'next/server';
import { createApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withCollaborationCreditRead } from './collaboration-credit-http';

jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
const token = 'synthetic-collaboration-read-token-1234567890';
const original = process.env.COLLABORATION_CREDIT_READ_TOKEN;
const request = (authorization?: string) => new NextRequest('http://localhost/api/integrations/collaboration/v1/credit-records', { headers: { ...(authorization ? { authorization } : {}), cookie: 'tls_session=factory-browser-session' } });

describe('collaboration read-only service boundary', () => {
  beforeEach(() => { jest.resetAllMocks(); process.env.COLLABORATION_CREDIT_READ_TOKEN = token; });
  afterAll(() => { if (original === undefined) delete process.env.COLLABORATION_CREDIT_READ_TOKEN; else process.env.COLLABORATION_CREDIT_READ_TOKEN = original; });
  it.each([undefined, 'Basic x', 'Bearer wrong', 'Bearer ml_excel_token', 'Bearer isolated-mucont-customers-read-token-1234567890'])('rejects credentials and browser identity from other scopes: %s', async authorization => {
    const read = jest.fn();
    const r = await withCollaborationCreditRead(request(authorization), read);
    expect(r.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
  it('returns no-store, an explicit contract and independent rate key without CORS or secrets in logs', async () => {
    const data = { companyName: 'PRIVATE COMPANY', contacts: { details: 'PRIVATE CONTACT' } };
    const r = await withCollaborationCreditRead(request(`Bearer ${token}`), async secret => { expect(secret).toBe(token); return data; });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(data);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-collaboration-contract')).toBe('credit-records/1.0.0');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(enforceRateLimit).toHaveBeenCalledWith('excelLookup', expect.anything(), { identityHint: 'collaboration-credit-records-read-v1' });
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toMatch(/PRIVATE|synthetic-collaboration-read-token/);
  });
  it('fails closed for missing/short config and dependency failure, without exposing connection information', async () => {
    const read = jest.fn();
    process.env.COLLABORATION_CREDIT_READ_TOKEN = '';
    expect((await withCollaborationCreditRead(request(`Bearer ${token}`), read)).status).toBe(503);
    process.env.COLLABORATION_CREDIT_READ_TOKEN = 'short';
    expect((await withCollaborationCreditRead(request(`Bearer ${token}`), read)).status).toBe(503);
    expect(read).not.toHaveBeenCalled();
    process.env.COLLABORATION_CREDIT_READ_TOKEN = token;
    const r = await withCollaborationCreditRead(request(`Bearer ${token}`), async () => { throw Error('mysql://PRIVATE-PASSWORD@PRIVATE-HOST'); });
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json()) + JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toMatch(/PRIVATE|mysql:\/\//);
  });
  it('preserves rate limit retry semantics even if dependency limiting fails before the source query', async () => {
    (enforceRateLimit as jest.Mock).mockRejectedValueOnce(createApiError({ code: 'RATE_LIMITED', status: 429, message: 'private setting detail', detail: { retryAfterMs: 1501 } }));
    const read = jest.fn();
    const r = await withCollaborationCreditRead(request(`Bearer ${token}`), read);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('2');
    expect((await r.json()).error).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 1501 });
    expect(read).not.toHaveBeenCalled();
  });
});
