/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { GET } from '@/app/api/integrations/collaboration/v2/credit-records/route';
import { listCreditRecordsV2 } from './collaboration-credit-v2';
import { encodeCreditCursor, listCollaborationCreditRecords } from './collaboration-credit-service';

jest.mock('@/lib/db', () => ({ db: { customer: { findMany: jest.fn() } } }));
jest.mock('@/lib/rate-limit', () => ({ enforceRateLimit: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));

const findMany = db.customer.findMany as jest.Mock;
const secret = 'isolated-credit-zero-read-token-1234567890';
const originalToken = process.env.COLLABORATION_CREDIT_READ_TOKEN;
const row = (id: string, credit: string) => ({
  id, credit: new Prisma.Decimal(credit), companyName: 'Synthetic company', companyAddress: null,
  companyContact: null, customerCode: null, creditCode: null, orderName: 'SYNTHETIC',
  phone: '+000 123', updatedAt: new Date('2026-11-17T00:00:00.000Z'),
});

describe('credit V2 opt-in zero-credit listing', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findMany.mockResolvedValue([]);
    process.env.COLLABORATION_CREDIT_READ_TOKEN = secret;
  });
  afterAll(() => {
    if (originalToken === undefined) delete process.env.COLLABORATION_CREDIT_READ_TOKEN;
    else process.env.COLLABORATION_CREDIT_READ_TOKEN = originalToken;
  });

  it.each(['', 'includeZero=false'])('preserves the positive-credit default for %s', async query => {
    await listCreditRecordsV2(new URLSearchParams(query), secret);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { credit: { gt: 0 } }, take: 21, orderBy: { id: 'asc' },
    }));
  });

  it('includes zero only when requested and paginates the same nonnegative source set', async () => {
    findMany.mockResolvedValueOnce([row('a', '0'), row('b', '10.25'), row('c', '0')]);
    const page = await listCreditRecordsV2(new URLSearchParams('includeZero=true&limit=2'), secret);
    expect(page.items.map(r => [r.creditRecordId, r.creditAmount, r.creditState]))
      .toEqual([['a', '0.00', 'ZERO'], ['b', '10.25', 'AVAILABLE']]);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { credit: { gte: 0 } }, take: 3 }));
    expect(page.hasMore).toBe(true);
    findMany.mockResolvedValueOnce([row('c', '0')]);
    const last = await listCreditRecordsV2(new URLSearchParams({ includeZero: 'true', cursor: page.nextCursor!, limit: '100' }), secret);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { credit: { gte: 0 }, id: { gt: 'b' } }, take: 51 }));
    expect(last).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('keeps old default cursors valid but rejects using a cursor with another filter', async () => {
    const oldCursor = encodeCreditCursor('a', secret, 'collaboration-credit-records-v2');
    await listCreditRecordsV2(new URLSearchParams({ cursor: oldCursor, includeZero: 'false' }), secret);
    await expect(listCreditRecordsV2(new URLSearchParams({ cursor: oldCursor, includeZero: 'true' }), secret))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    findMany.mockResolvedValueOnce([row('a', '0'), row('b', '1')]);
    const page = await listCreditRecordsV2(new URLSearchParams('includeZero=true&limit=1'), secret);
    await expect(listCreditRecordsV2(new URLSearchParams({ cursor: page.nextCursor! }), secret))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    await expect(listCollaborationCreditRecords(new URLSearchParams({ cursor: page.nextCursor! }), secret))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
  });

  it.each(['includeZero=', 'includeZero=1', 'includeZero=TRUE', 'includeZero=null',
    'includeZero=true&includeZero=false', 'includeZero=true&limit=0', 'includeZero=true&factoryId=other'])
  ('rejects invalid or scope-changing query %s before accessing storage', async query => {
    await expect(listCreditRecordsV2(new URLSearchParams(query), secret))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps V1 positive-only and rejects the V2-only option there', async () => {
    await expect(listCollaborationCreditRecords(new URLSearchParams('includeZero=true'), secret))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
    await listCollaborationCreditRecords(new URLSearchParams(), secret);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { credit: { gt: 0 } } }));
  });

  it('uses the existing read credential and response contract for the actual GET route', async () => {
    const url = 'http://localhost/api/integrations/collaboration/v2/credit-records?includeZero=true';
    for (const token of [null, 'isolated-wrong-token']) {
      const denied = await GET(new NextRequest(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }));
      expect(denied.status).toBe(401);
    }
    expect(findMany).not.toHaveBeenCalled();
    findMany.mockResolvedValueOnce([row('a', '0')]);
    const response = await GET(new NextRequest(url, { headers: { authorization: `Bearer ${secret}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-collaboration-contract')).toBe('credit-records/2.0.0');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).items[0]).toMatchObject({ creditRecordId: 'a', creditAmount: '0.00', creditState: 'ZERO' });
  });
});
