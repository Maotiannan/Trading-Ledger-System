/** @jest-environment node */
jest.mock('./whatsapp-live-source', () => ({ resolveWhatsAppSource: jest.fn() }));
import { refreshWhatsAppInTransaction } from './whatsapp-refresh';
import { resolveWhatsAppSource } from './whatsapp-live-source';
import { renderWhatsAppSnapshot } from './whatsapp-template';
import type { DbTransactionClient } from '@/lib/transaction';

const snapshot = { customerId: 'c', customerName: 'Customer', language: 'ENGLISH', orderNos: ['A-1'], invoiceNo: 'INV', receiptNo: 'R1', amount: 2000, orderBalance: 8000 };
const contact = { id: 'contact' };
const initial = { id: 'task', status: 'QUEUED', updatedAt: new Date(0), businessSnapshot: snapshot, ...renderWhatsAppSnapshot('PAYMENT_RECEIVED', snapshot), type: 'PAYMENT_RECEIVED', contactId: 'contact', intendedTo: '+224620123456', actualTo: '+224620123456', nextSendAt: new Date(0) };
let row: typeof initial;
const updateMany = jest.fn();
const tx = { whatsAppDelivery: { findUnique: jest.fn(async () => row), updateMany },
  emailNotification: { findUnique: jest.fn(async () => ({ id: 'source', createdAt: new Date() })) },
  customerWhatsAppContact: { findFirst: jest.fn(async () => contact) },
} as unknown as DbTransactionClient;
beforeEach(() => {
  jest.clearAllMocks(); row = { ...initial };
  updateMany.mockResolvedValue({ count: 1 });
  (resolveWhatsAppSource as jest.Mock).mockResolvedValue({ customer: { id: 'c', phone: row.intendedTo }, paused: false, snapshot });
});
it('does not rewrite unchanged content or reset the clock', async () => {
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).not.toHaveBeenCalled();
});
it('updates material content and revokes previous approval', async () => {
  (resolveWhatsAppSource as jest.Mock).mockResolvedValue({ customer: { id: 'c', phone: row.intendedTo }, paused: false, snapshot: { ...snapshot, amount: 3000, orderBalance: 7000 } });
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parameters: expect.arrayContaining(['3,000', '7,000']), approvedAt: null, nextSendAt: expect.any(Date) }) }));
});
it('pauses deletion and restores with five minute buffer after rejection', async () => {
  (resolveWhatsAppSource as jest.Mock).mockResolvedValueOnce({ customer: { id: 'c', phone: row.intendedTo }, paused: true, snapshot });
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PAUSED', failureCode: 'DELETION_PENDING' }) }));
  row.status = 'PAUSED';
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED', nextSendAt: expect.any(Date) }) }));
});
it('cancels only an unsent source after approved deletion', async () => {
  (resolveWhatsAppSource as jest.Mock).mockResolvedValue(null);
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED', failureCode: 'SOURCE_REMOVED' } }));
});
it.each(['CANCELLED', 'SENDING', 'SENT', 'UNCERTAIN'])('never rewrites or recreates %s', async status => {
  row.status = status;
  await refreshWhatsAppInTransaction(tx, row.id, []);
  expect(updateMany).not.toHaveBeenCalled();
});
