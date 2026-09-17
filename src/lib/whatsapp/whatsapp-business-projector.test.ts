/** @jest-environment node */
jest.mock('@/lib/db', () => ({ db: { emailNotification: { findMany: jest.fn() }, customerWhatsAppContact: { findMany: jest.fn() } } }));
jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn(async fn => fn({})) }));
jest.mock('./whatsapp-template-service', () => ({ listWhatsAppTemplateVersions: jest.fn(async () => []) }));
jest.mock('./whatsapp-settings', () => ({ getWhatsAppSettings: jest.fn() }));
jest.mock('./whatsapp-queue', () => ({ enqueueWhatsAppInTransaction: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }));
import { db } from '@/lib/db';
import { getWhatsAppSettings } from './whatsapp-settings';
import { enqueueWhatsAppInTransaction } from './whatsapp-queue';
import { projectWhatsAppBusinessEvents } from './whatsapp-business-projector';
const source = { id: 'source', type: 'PAYMENT_RECEIVED', createdAt: new Date('2026-09-16T00:00:00Z'), customerId: 'customer', currentSnapshot: { customerName: 'Client', language: 'ENGLISH', orderNos: ['ORDER-1'], invoiceNo: 'INV-1', receiptNo: 'R-1', amount: 100, orderBalance: 900 } };
const originalSender = process.env.YCLOUD_SENDER_PHONE;
beforeEach(() => {
  jest.clearAllMocks(); process.env.YCLOUD_SENDER_PHONE = '+123456789';
  (getWhatsAppSettings as jest.Mock).mockResolvedValue({ activatedAt: '2026-09-15T00:00:00Z', testMode: true, testDestination: '+10000000002' });
  (db.emailNotification.findMany as jest.Mock).mockResolvedValue([source]);
  (db.customerWhatsAppContact.findMany as jest.Mock).mockResolvedValue([{ id: 'contact' }]);
});
afterEach(() => { if (originalSender === undefined) delete process.env.YCLOUD_SENDER_PHONE; else process.env.YCLOUD_SENDER_PHONE = originalSender; });
it('only projects post-activation events for contacts who already consented when the event occurred', async () => {
  await projectWhatsAppBusinessEvents();
  expect(db.emailNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: new Date('2026-09-15T00:00:00Z') } }) }));
  expect(db.customerWhatsAppContact.findMany).toHaveBeenCalledWith({ where: { customerId: 'customer', optedInAt: { lte: source.createdAt }, optedOutAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 1 });
  expect(enqueueWhatsAppInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceId: 'source', contactId: 'contact', testMode: true, parameters: expect.arrayContaining(['900']) }));
});
it('does not initialize historical backlogs implicitly', async () => {
  (getWhatsAppSettings as jest.Mock).mockResolvedValue({ activatedAt: null });
  await projectWhatsAppBusinessEvents();
  expect(db.emailNotification.findMany).not.toHaveBeenCalled();
});
it('bad content does not block valid events', async () => {
  (db.emailNotification.findMany as jest.Mock).mockResolvedValue([{ ...source, currentSnapshot: {} }, source]);
  await projectWhatsAppBusinessEvents();
  expect(enqueueWhatsAppInTransaction).toHaveBeenCalledTimes(1);
});
