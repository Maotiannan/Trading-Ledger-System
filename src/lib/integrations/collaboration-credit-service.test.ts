/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { db } from '@/lib/db';
import { listCollaborationCreditRecords, readCollaborationCreditRecord } from './collaboration-credit-service';

jest.mock('@/lib/db', () => ({ db: { customer: { findMany: jest.fn(), findUnique: jest.fn() } } }));
const customer = db.customer as unknown as { findMany: jest.Mock; findUnique: jest.Mock };
const secret = 'synthetic-collaboration-credit-token-1234567890';
const row = (id: string, amount: string | null = '1250.01') => ({
  id, companyName: 'Same Company', companyAddress: null, companyContact: null,
  credit: amount === null ? null : new Prisma.Decimal(amount), updatedAt: new Date('2026-11-03T07:00:00.000Z'),
  phone: 'PRIVATE CUSTOMER PHONE', ownerId: 'PRIVATE OWNER', name: 'PRIVATE CUSTOMER',
});

describe('collaboration credit source reads', () => {
  beforeEach(() => { jest.resetAllMocks(); customer.findMany.mockResolvedValue([]); });

  it('projects only company credit facts, preserves same-name identities and exact decimal precision', async () => {
    customer.findMany.mockResolvedValueOnce([row('a', '9007199254740993.01'), row('b', '0.01'), row('c')]);
    const page = await listCollaborationCreditRecords(new URLSearchParams('limit=2'), secret);
    expect(page.items.map(r => [r.creditRecordId, r.creditAmount])).toEqual([['a', '9007199254740993.01'], ['b', '0.01']]);
    expect(page.items[0].companyName).toBe(page.items[1].companyName);
    expect(customer.findMany).toHaveBeenCalledWith({
      where: { credit: { gt: 0 } },
      select: { id: true, companyName: true, credit: true, companyAddress: true, companyContact: true, updatedAt: true },
      orderBy: { id: 'asc' }, take: 3,
    });
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|ownerId|customerId|phone|orderBalance/);
    customer.findMany.mockResolvedValueOnce([row('c')]);
    const last = await listCollaborationCreditRecords(new URLSearchParams({ cursor: page.nextCursor!, limit: '20' }), secret);
    expect(customer.findMany.mock.calls[1][0].where).toEqual({ credit: { gt: 0 }, id: { gt: 'b' } });
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
  });

  it.each(['0', '-1', '1.5', 'NaN', '1e2', '', '99999999999999999999'])('rejects invalid limit %s before reading', async limit => {
    await expect(listCollaborationCreditRecords(new URLSearchParams({ limit }), secret)).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
    expect(customer.findMany).not.toHaveBeenCalled();
  });

  it('caps batches, handles empty final pages, rejects duplicate/unknown parameters and scoped cursor forgery', async () => {
    const empty = await listCollaborationCreditRecords(new URLSearchParams('limit=100'), secret);
    expect(empty).toMatchObject({ items: [], hasMore: false, nextCursor: null });
    expect(customer.findMany.mock.calls[0][0].take).toBe(51);
    for (const query of ['q=anything', 'limit=1&limit=2', 'cursor=', 'cursor=forged']) {
      await expect(listCollaborationCreditRecords(new URLSearchParams(query), secret)).rejects.toMatchObject({ status: 400 });
    }
    customer.findMany.mockResolvedValueOnce([row('a'), row('b')]);
    const first = await listCollaborationCreditRecords(new URLSearchParams('limit=1'), secret);
    await expect(listCollaborationCreditRecords(new URLSearchParams({ cursor: first.nextCursor! }), 'rotated-secret')).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const legacyPayload = Buffer.from(JSON.stringify({ v: 1, sort: 'customerId:asc', q: '', id: 'a' })).toString('base64url');
    const legacyCursor = legacyPayload + '.' + createHmac('sha256', secret).update(`mucont-customers-v1:${legacyPayload}`).digest('base64url');
    await expect(listCollaborationCreditRecords(new URLSearchParams({ cursor: legacyCursor }), secret)).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it.each([[null, 'UNSET'], ['0', 'ZERO'], ['-1', 'INVALID'], ['1.23', 'AVAILABLE']] as const)('distinguishes %s without hiding the source or inventing contact information', async (amount, state) => {
    customer.findUnique.mockResolvedValueOnce({ ...row('stable', amount), companyName: ' ', companyAddress: '', companyContact: ' ' });
    const record = await readCollaborationCreditRecord('stable');
    expect(record).toMatchObject({ creditRecordId: 'stable', creditState: state, currency: 'USD', companyName: null, address: null, contacts: { details: null } });
    expect(record.creditAmount).toBe(amount === null ? null : new Prisma.Decimal(amount).toFixed(2));
    expect(record.missingFields).toEqual(expect.arrayContaining(['companyName', 'address', 'contacts.details']));
    expect(record.missingFields.includes('creditAmount')).toBe(amount === null);
  });

  it('has deterministic versions, detects same-millisecond content changes and does not follow customer ownership', async () => {
    const source = { ...row('stable'), companyContact: 'Company desk', companyAddress: 'Company address' };
    customer.findUnique.mockResolvedValueOnce(source).mockResolvedValueOnce({ ...source, ownerId: 'changed-owner' }).mockResolvedValueOnce({ ...source, credit: new Prisma.Decimal('99.99') });
    const first = await readCollaborationCreditRecord('stable');
    expect((await readCollaborationCreditRecord('stable')).sourceVersion).toBe(first.sourceVersion);
    expect((await readCollaborationCreditRecord('stable')).sourceVersion).not.toBe(first.sourceVersion);
    expect(first.sourceUpdatedAt).toBe('2026-11-03T07:00:00.000Z');
    expect(first.contacts).toEqual({ details: 'Company desk' });
    expect(customer.findUnique.mock.calls[0][0].where).toEqual({ id: 'stable' });
  });

  it('returns explicit deletion and validates IDs without display-name fallback', async () => {
    customer.findUnique.mockResolvedValueOnce(null);
    await expect(readCollaborationCreditRecord('deleted')).rejects.toMatchObject({ status: 404, code: 'CREDIT_RECORD_NOT_FOUND' });
    for (const id of ['', ' bad ', 'x'.repeat(192)]) await expect(readCollaborationCreditRecord(id)).rejects.toMatchObject({ status: 400 });
    expect(customer.findUnique).toHaveBeenCalledTimes(1);
  });
});
