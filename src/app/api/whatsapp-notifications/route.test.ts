/** @jest-environment node */
jest.mock('@/lib/request-auth', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { $transaction: jest.fn(), whatsAppDelivery: { findMany: jest.fn(), count: jest.fn() } } }));
jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn() }));
jest.mock('@/lib/whatsapp/whatsapp-queue', () => ({ approveWhatsAppTestInTransaction: jest.fn() }));
import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/request-auth';
import { GET, POST } from './route';
import { db } from '@/lib/db';
import { runInTransaction } from '@/lib/transaction';
import { approveWhatsAppTestInTransaction } from '@/lib/whatsapp/whatsapp-queue';
beforeEach(() => { jest.resetAllMocks(); (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'admin', role: 'ADMIN' }); });
it.each(['SALES', 'USER'])('denies both read and approval for %s', async role => {
  (getCurrentUser as jest.Mock).mockResolvedValue({ role });
  expect((await GET(new NextRequest('http://localhost/api/whatsapp-notifications'))).status).toBe(403);
  expect((await POST(new NextRequest('http://localhost/api/whatsapp-notifications', { method: 'POST' }))).status).toBe(403);
  expect(db.whatsAppDelivery.findMany).not.toHaveBeenCalled();
});
it('rejects non-numeric and oversized pagination', async () => {
  expect((await GET(new NextRequest('http://localhost/api/whatsapp-notifications?page=NaN'))).status).toBe(400);
  expect((await GET(new NextRequest('http://localhost/api/whatsapp-notifications?pageSize=9999'))).status).toBe(400);
});
it('approves each ID once inside the transaction without sending', async () => {
  (runInTransaction as jest.Mock).mockImplementation(async fn => fn({}));
  (approveWhatsAppTestInTransaction as jest.Mock).mockResolvedValue({ count: 1 });
  const result = await POST(new NextRequest('http://localhost/api/whatsapp-notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve', ids: ['one', 'one'] }) }));
  expect(result.status).toBe(200);
  expect(approveWhatsAppTestInTransaction).toHaveBeenCalledTimes(1);
});
