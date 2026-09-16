/** @jest-environment node */
jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn() }));
import { runInTransaction } from '@/lib/transaction';
import { parseYCloudDeliveryEvent, storeYCloudDeliveryEvent } from './ycloud-webhook-storage';
const event = { id: 'event', type: 'whatsapp.message.updated', createTime: '2026-09-15T12:00:00Z', whatsappMessage: { id: 'provider', wabaId: 'account', from: '+123456789', to: '+224620123456', status: 'delivered', text: { body: 'do not persist' } } };
const scope = { wabaId: 'account', senderPhone: '+123456789' };
it('validates account ownership and strips unrelated message content', () => {
  expect(parseYCloudDeliveryEvent(JSON.stringify(event), scope).whatsappMessage).not.toHaveProperty('text');
  expect(() => parseYCloudDeliveryEvent(JSON.stringify(event), { ...scope, wabaId: 'other' })).toThrow();
});
it('rejects malformed dates and unrelated event types', () => {
  expect(() => parseYCloudDeliveryEvent(JSON.stringify({ ...event, createTime: 'bad' }), scope)).toThrow();
  expect(() => parseYCloudDeliveryEvent(JSON.stringify({ ...event, type: 'whatsapp.inbound_message.received' }), scope)).toThrow();
});
it('uses unique provider event key with no duplicate overwrite, within a transaction', async () => {
  const upsert = jest.fn().mockResolvedValue({ id: 'stored' });
  (runInTransaction as jest.Mock).mockImplementation(async (fn) => fn({ whatsAppWebhookEvent: { upsert }, whatsAppDelivery: { findFirst: jest.fn().mockResolvedValue(null) } }));
  await expect(storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify(event), scope))).resolves.toEqual({ stored: true, eventId: 'stored' });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { providerEventId: 'event' }, update: {} }));
  upsert.mockRejectedValue(new Error('storage failure'));
  await expect(storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify(event), scope))).rejects.toThrow('storage failure');
});

it.each(['READ', 'DELIVERED'])('never downgrades %s after a late sent event', async status => {
  const updateMany = jest.fn();
  const update = jest.fn();
  (runInTransaction as jest.Mock).mockImplementation(async fn => fn({
    whatsAppWebhookEvent: { upsert: jest.fn().mockResolvedValue({ id: 'stored', appliedAt: null }), update },
    whatsAppDelivery: { findFirst: jest.fn().mockResolvedValue({ id: 'delivery', status }), updateMany },
  }));
  await storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify({ ...event, whatsappMessage: { ...event.whatsappMessage, status: 'sent' } }), scope));
  expect(updateMany).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledTimes(1);
});
it('applies confirmation before the send response persists, via delivery ID and matching phone numbers', async () => {
  const findFirst = jest.fn().mockResolvedValue({ id: 'delivery', status: 'SENDING' });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const update = jest.fn();
  (runInTransaction as jest.Mock).mockImplementation(async fn => fn({
    whatsAppWebhookEvent: { upsert: jest.fn().mockResolvedValue({ id: 'stored', appliedAt: null }), update },
    whatsAppDelivery: { findFirst, updateMany },
  }));
  await storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify({ ...event, whatsappMessage: { ...event.whatsappMessage, externalId: 'delivery' } }), scope));
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ actualTo: event.whatsappMessage.to, senderPhone: scope.senderPhone, OR: expect.arrayContaining([{ id: 'delivery', providerMessageId: null }]) }) }));
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'delivery', status: 'SENDING' }, data: expect.objectContaining({ status: 'DELIVERED', providerMessageId: 'provider' }) }));
});
it('does not apply a duplicate already processed event', async () => {
  const findFirst = jest.fn();
  (runInTransaction as jest.Mock).mockImplementation(async fn => fn({
    whatsAppWebhookEvent: { upsert: jest.fn().mockResolvedValue({ id: 'stored', appliedAt: new Date() }) },
    whatsAppDelivery: { findFirst },
  }));
  await storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify(event), scope));
  expect(findFirst).not.toHaveBeenCalled();
});
