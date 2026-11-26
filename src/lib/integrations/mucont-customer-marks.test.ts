/** @jest-environment node */
import { db } from '@/lib/db';
import { readMucontCustomerMarks } from './mucont-customer-service';
jest.mock('@/lib/db', () => ({ db: { customer: { findMany: jest.fn() } } }));
beforeEach(() => jest.resetAllMocks());
it('batches stable IDs and exposes database updatedAt, including blank and missing marks', async () => {
  const updatedAt = new Date('2026-11-13T00:00:00Z');
  (db.customer.findMany as jest.Mock).mockResolvedValue([{ id: 'b', mark: ' ', updatedAt }, { id: 'a', mark: 'NEW', updatedAt }]);
  expect(await readMucontCustomerMarks({ customerIds: ['a', 'b', 'a', 'missing'] })).toEqual({ items: [
    { customerId: 'a', mark: 'NEW', sourceVersion: updatedAt.toISOString() }, { customerId: 'b', mark: null, sourceVersion: updatedAt.toISOString() },
  ], missingCustomerIds: ['missing'] });
  expect(db.customer.findMany).toHaveBeenCalledTimes(1);
  expect(db.customer.findMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b', 'missing'] } }, select: { id: true, mark: true, updatedAt: true } });
});
it('bounds requests and treats an empty set as a no-op', async () => {
  await expect(readMucontCustomerMarks({ customerIds: Array.from({ length: 201 }, (_, i) => `id-${i}`) })).rejects.toMatchObject({ status: 400 });
  expect(await readMucontCustomerMarks({ customerIds: [] })).toEqual({ items: [], missingCustomerIds: [] });
  expect(db.customer.findMany).not.toHaveBeenCalled();
});
it('applies the batch limit after deduplicating stable IDs', async () => {
  (db.customer.findMany as jest.Mock).mockResolvedValue([]);
  expect(await readMucontCustomerMarks({ customerIds: Array(201).fill('same') })).toEqual({ items: [], missingCustomerIds: ['same'] });
  expect(db.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['same'] } } }));
});
