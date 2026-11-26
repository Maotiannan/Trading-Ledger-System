/** @jest-environment node */
import { NextRequest } from 'next/server';
import { createApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { withCreditV2 } from './collaboration-credit-v2-http';

jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
const readToken = 'synthetic-read-token-12345678901234567890';
const writeToken = 'synthetic-write-token-12345678901234567890';
const keys = ['COLLABORATION_CREDIT_READ_TOKEN', 'COLLABORATION_CREDIT_WRITE_TOKEN', 'COLLABORATION_CREDIT_WRITE_ACTOR_ID'];
const original = keys.map(key => process.env[key]);
const request = (token = writeToken) => new NextRequest('http://localhost/api/integrations/collaboration/v2/credit-records/synthetic/writeback', { headers: { authorization: `Bearer ${token}` } });

describe('credit V2 service boundary', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.COLLABORATION_CREDIT_READ_TOKEN = readToken;
    process.env.COLLABORATION_CREDIT_WRITE_TOKEN = writeToken;
    process.env.COLLABORATION_CREDIT_WRITE_ACTOR_ID = 'synthetic-admin';
  });
  afterAll(() => keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i]; }));
  it('fails closed for missing, shared or wrong write credentials and missing audit principal', async () => {
    const action = jest.fn();
    expect((await withCreditV2(request(readToken), 'write', action)).status).toBe(401);
    process.env.COLLABORATION_CREDIT_WRITE_TOKEN = readToken;
    expect((await withCreditV2(request(readToken), 'write', action)).status).toBe(503);
    process.env.COLLABORATION_CREDIT_WRITE_TOKEN = '';
    expect((await withCreditV2(request(), 'write', action)).status).toBe(503);
    process.env.COLLABORATION_CREDIT_WRITE_TOKEN = writeToken;
    process.env.COLLABORATION_CREDIT_WRITE_ACTOR_ID = '';
    expect((await withCreditV2(request(), 'write', action)).status).toBe(503);
    expect(action).not.toHaveBeenCalled();
  });
  it('passes only configured audit principal and excludes bodies and credentials from operational logs', async () => {
    const action = jest.fn().mockResolvedValue({ record: { companyName: 'PRIVATE COMPANY' } });
    const response = await withCreditV2(request(), 'write', action);
    expect(action).toHaveBeenCalledWith(writeToken, 'synthetic-admin');
    expect(response.headers.get('x-collaboration-contract')).toBe('credit-records/2.0.0');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toMatch(/PRIVATE|synthetic-write-token/);
    expect(enforceRateLimit).toHaveBeenCalledWith('excelLookup', expect.anything(), { identityHint: 'collaboration-credit-v2-write' });
  });
  it('redacts dependency errors and reports precise retry delay', async () => {
    const response = await withCreditV2(request(), 'write', async () => { throw Error('mysql://PRIVATE@HOST'); });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json()) + JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('PRIVATE');
    (enforceRateLimit as jest.Mock).mockRejectedValueOnce(createApiError({ code: 'RATE_LIMITED', status: 429, message: 'PRIVATE LIMIT DETAIL', detail: { retryAfterMs: 1501 } }));
    const limited = await withCreditV2(request(), 'write', jest.fn());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('2');
    expect((await limited.json()).error).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 1501 });
  });
});
