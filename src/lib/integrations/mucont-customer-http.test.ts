/** @jest-environment node */
import { NextRequest } from 'next/server';
import { createApiError } from '@/lib/api-error';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { MucontCustomerError, withMucontCustomerRead } from './mucont-customer-http';

jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
const token = 'synthetic-service-read-token-1234567890';
const originalToken = process.env.MUCONT_CUSTOMERS_READ_TOKEN;
const request = (authorization?: string) => new NextRequest('http://localhost/api/integrations/mucont/v1/customers/options', {
  headers: authorization ? { authorization } : {},
});

describe('mucont customer service credential and errors', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.MUCONT_CUSTOMERS_READ_TOKEN = token; });
  afterAll(() => {
    if (originalToken === undefined) delete process.env.MUCONT_CUSTOMERS_READ_TOKEN;
    else process.env.MUCONT_CUSTOMERS_READ_TOKEN = originalToken;
  });

  it.each([
    [undefined, 'AUTH_REQUIRED'], ['Bearer wrong', 'AUTH_INVALID'], ['Basic x', 'AUTH_INVALID'],
    ['Bearer ml_existing_excel_token', 'AUTH_INVALID'],
  ])('requires the dedicated credential (%s)', async (header, code) => {
    const read = jest.fn();
    const response = await withMucontCustomerRead(request(header), read);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code, message: expect.any(String) } });
    expect(read).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('limits and logs reads without exposing credentials or profiles', async () => {
    const result = { items: [], hasMore: false, nextCursor: null };
    const response = await withMucontCustomerRead(request(`Bearer ${token}`), async () => result);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(enforceRateLimit).toHaveBeenCalledWith('excelLookup', expect.anything(), { identityHint: 'mucont-customer-read-v1' });
    expect(JSON.stringify((logger.info as jest.Mock).mock.calls)).not.toContain(token);
  });

  it('returns 503 when disabled, and when the database fails without leaking details', async () => {
    delete process.env.MUCONT_CUSTOMERS_READ_TOKEN;
    expect((await withMucontCustomerRead(request(`Bearer ${token}`), jest.fn())).status).toBe(503);
    process.env.MUCONT_CUSTOMERS_READ_TOKEN = token;
    const response = await withMucontCustomerRead(request(`Bearer ${token}`), async () => { throw new Error('private database credentials'); });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Customer service is temporarily unavailable.' } });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('private database credentials');
  });

  it('preserves missing-customer semantics and rate-limit retry headers', async () => {
    const missing = await withMucontCustomerRead(request(`Bearer ${token}`), async () => {
      throw new MucontCustomerError(404, 'CUSTOMER_NOT_FOUND', 'Customer has been deleted or does not exist.', 'deleted');
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.customerId).toBe('deleted');
    (enforceRateLimit as jest.Mock).mockRejectedValueOnce(createApiError({ code: 'RATE_LIMITED', status: 429, message: 'rate limited', detail: { retryAfterMs: 1501 } }));
    const limited = await withMucontCustomerRead(request(`Bearer ${token}`), jest.fn());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('2');
    expect((await limited.json()).error.retryAfterMs).toBe(1501);
  });
});
