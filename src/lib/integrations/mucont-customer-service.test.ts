/** @jest-environment node */
import { db } from '@/lib/db';
import { listMucontCustomerOptions, readMucontCustomerProfile } from './mucont-customer-service';

jest.mock('@/lib/db', () => ({ db: { customer: { findMany: jest.fn(), findUnique: jest.fn() }, $transaction: jest.fn() } }));
const mockDb = db as unknown as {
  customer: { findMany: jest.Mock; findUnique: jest.Mock }; $transaction: jest.Mock;
};
const key = 'synthetic-customer-read-credential-123456789';
const option = (id: string) => ({ id, name: 'Same Name', mark: 'SAME', companyName: null });

describe('mucont all-customer reads', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.$transaction.mockImplementation((read) => read(mockDb));
    mockDb.customer.findMany.mockResolvedValue([]);
  });

  it('paginates by stable ID, keeps duplicate display values and projects only candidate fields', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([option('a'), option('b'), option('c')]);
    const first = await listMucontCustomerOptions(new URLSearchParams('limit=2'), key);
    expect(first.items.map((item) => item.customerId)).toEqual(['a', 'b']);
    expect(first.hasMore).toBe(true);
    expect(mockDb.customer.findMany).toHaveBeenCalledWith({
      where: {}, select: { id: true, mark: true, name: true, companyName: true },
      orderBy: { id: 'asc' }, take: 3,
    });
    mockDb.customer.findMany.mockResolvedValueOnce([option('c')]);
    const last = await listMucontCustomerOptions(new URLSearchParams({ limit: '2', cursor: first.nextCursor! }), key);
    expect(mockDb.customer.findMany.mock.calls[1][0].where).toEqual({ id: { gt: 'b' } });
    expect(last).toEqual({ items: [{ customerId: 'c', mark: 'SAME', name: 'Same Name', companyName: null }], nextCursor: null, hasMore: false });
  });

  it('searches all customer text and alias fields in the database without owner filtering', async () => {
    await listMucontCustomerOptions(new URLSearchParams('q=SuPer%20DT&limit=100'), key);
    const query = mockDb.customer.findMany.mock.calls[0][0];
    expect(query.take).toBe(51);
    expect(query.where.OR).toEqual(expect.arrayContaining([
      { name: { contains: 'super dt' } }, { companyName: { contains: 'super dt' } },
      { mark: { contains: 'super dt' } }, { orderName: { contains: 'super dt' } },
      { orderNames: { some: { OR: [{ orderName: { contains: 'super dt' } }, { normalizedOrderName: { contains: 'superdt' } }] } } },
    ]));
    expect(JSON.stringify(query.where)).not.toContain('ownerId');
    expect(query.select).not.toHaveProperty('orderNames');
  });

  it('rejects forged, malformed and wrong-query cursors before reading', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([option('a'), option('b')]);
    const first = await listMucontCustomerOptions(new URLSearchParams('limit=1&q=DEMO'), key);
    for (const cursor of ['not-a-cursor', first.nextCursor! + 'x']) {
      await expect(listMucontCustomerOptions(new URLSearchParams({ q: 'demo', cursor }), key)).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    }
    await expect(listMucontCustomerOptions(new URLSearchParams({ q: 'other', cursor: first.nextCursor! }), key)).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    expect(mockDb.customer.findMany).toHaveBeenCalledTimes(1);
    await listMucontCustomerOptions(new URLSearchParams({ q: '  ＤＥＭＯ  ', cursor: first.nextCursor! }), key);
    expect(mockDb.customer.findMany).toHaveBeenCalledTimes(2);
  });

  it.each(['0', '-1', '1.5', 'NaN', '1e2'])('rejects invalid limit %s', async (limit) => {
    await expect(listMucontCustomerOptions(new URLSearchParams({ limit }), key)).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
  });

  it('defaults to 20 and returns null/false for an empty last page', async () => {
    expect(await listMucontCustomerOptions(new URLSearchParams(), key)).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(mockDb.customer.findMany.mock.calls[0][0].take).toBe(21);
  });

  it('reads current master fields by ID in one repeatable-read transaction, including aliases and consignees', async () => {
    const row = { ...option('a'), companyAddress: 'Current address', phone: '123', city: 'Conakry',
      orderName: 'DEMO', orderNames: [{ orderName: 'DEMO' }, { orderName: 'DEMO OLD' }],
      consignee: '-', consignees: [{ consignee: '-', isPrimary: false }, { consignee: 'Receiver', isPrimary: true }, { consignee: 'Second receiver', isPrimary: false }] };
    mockDb.customer.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, companyAddress: 'New address' });
    const first = await readMucontCustomerProfile('a');
    expect(first).toEqual({ customerId: 'a', capturedAt: expect.any(String), completeness: 'MASTER_FULL',
      profile: { name: 'Same Name', mark: 'SAME', companyName: null, companyAddress: 'Current address', phone: '123', city: 'Conakry',
        orderNames: ['DEMO', 'DEMO OLD'], consignee: 'Receiver', consignees: ['Receiver', 'Second receiver'] } });
    const second = await readMucontCustomerProfile('a');
    expect(second.profile.companyAddress).toBe('New address');
    expect(mockDb.customer.findUnique.mock.calls[0][0].where).toEqual({ id: 'a' });
    expect(mockDb.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    expect(mockDb.customer.findMany).not.toHaveBeenCalled();
  });

  it('keeps missing fields explicit and returns 404 without matching by display name', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce({ id: 'empty', name: '', mark: '', phone: '', city: '', orderName: '', orderNames: [], consignees: [] }).mockResolvedValueOnce(null);
    const result = await readMucontCustomerProfile('empty');
    expect(result.profile).toEqual({ name: null, mark: null, phone: null, city: null, companyName: null, companyAddress: null, orderNames: [], consignee: null, consignees: [] });
    await expect(readMucontCustomerProfile('deleted')).rejects.toMatchObject({ status: 404, code: 'CUSTOMER_NOT_FOUND', customerId: 'deleted' });
  });
});
