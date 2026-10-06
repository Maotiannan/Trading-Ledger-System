/** @jest-environment node */
jest.mock('@/lib/db', () => ({ db: { whatsAppDelivery: { updateMany: jest.fn() } } }));
jest.mock('@/lib/customer-outstanding-statement-server', () => ({ renderOutstandingStatementPng: jest.fn(async () => Buffer.from('image')) }));
jest.mock('@/lib/upload', () => ({ saveUploadedImage: jest.fn(async () => ({ path: '/upload/images/whatsapp-statements/test.png' })) }));
import { db } from '@/lib/db';
import { renderOutstandingStatementPng } from '@/lib/customer-outstanding-statement-server';
import { saveUploadedImage } from '@/lib/upload';
import { prepareReminderMedia } from './outstanding-reminder-media';
import type { WhatsAppDelivery } from '@prisma/client';
const originalFetch = global.fetch;
const delivery = { id: 'delivery', claimToken: 'claim', businessSnapshot: { outstanding: { customerId: 'customer' }, statementDate: '2026-10-06' } } as unknown as WhatsAppDelivery;
beforeEach(() => {
  jest.clearAllMocks();
  (db.whatsAppDelivery.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ id: 'media-id' })));
});
afterAll(() => { global.fetch = originalFetch; });
it('regenerates from the frozen snapshot, archives locally, then uploads media without sending', async () => {
  await expect(prepareReminderMedia(delivery, { apiKey: 'test-only', senderPhone: '+1234567890' })).resolves.toBe('media-id');
  expect(renderOutstandingStatementPng).toHaveBeenCalledWith({ customerId: 'customer' }, new Date('2026-10-06'));
  expect(saveUploadedImage).toHaveBeenCalledWith(expect.any(File), { subDir: 'whatsapp-statements' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('/media/%2B1234567890/upload');
});
it('stops before external upload if the sending claim was lost', async () => {
  (db.whatsAppDelivery.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(prepareReminderMedia(delivery, { apiKey: 'test-only', senderPhone: '+1234567890' })).rejects.toThrow('claim');
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects missing media IDs instead of sending an image-less reminder', async () => {
  global.fetch = jest.fn(async () => new Response('{}'));
  await expect(prepareReminderMedia(delivery, { apiKey: 'test-only', senderPhone: '+1234567890' })).rejects.toThrow('not confirmed');
});
