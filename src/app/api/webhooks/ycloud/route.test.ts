/** @jest-environment node */
import { createHmac } from 'node:crypto';
import { POST } from './route';
import { storeYCloudDeliveryEvent } from '@/lib/whatsapp/ycloud-webhook-storage';
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/whatsapp/ycloud-webhook-storage', () => ({
  ...jest.requireActual('@/lib/whatsapp/ycloud-webhook-storage'), storeYCloudDeliveryEvent: jest.fn(),
}));
jest.mock('@/lib/transaction', () => ({ runInTransaction: jest.fn() }));
const original = { ...process.env };
const body = JSON.stringify({ id: 'event', type: 'whatsapp.message.updated', createTime: '2026-09-15T12:00:00Z', whatsappMessage: { id: 'message', wabaId: 'account', from: '+123456789', to: '+224620123456', status: 'sent' } });
function request(signed = true, payload = body) {
  const t = Math.floor(Date.now() / 1000);
  const s = createHmac('sha256', 'test-secret').update(t + '.' + payload).digest('hex');
  return new Request('http://localhost/api/webhooks/ycloud', { method: 'POST', body: payload, headers: signed ? { 'YCloud-Signature': 't=' + t + ',s=' + s } : {} });
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, { YCLOUD_WEBHOOK_SECRET: 'test-secret', YCLOUD_WABA_ID: 'account', YCLOUD_SENDER_PHONE: '+123456789', WHATSAPP_WEBHOOK_ENABLED: 'true' });
  (storeYCloudDeliveryEvent as jest.Mock).mockResolvedValue({ stored: true, eventId: 'stored' });
});
afterEach(() => { process.env = { ...original }; });
it('fails closed when disabled', async () => {
  delete process.env.WHATSAPP_WEBHOOK_ENABLED;
  expect((await POST(request())).status).toBe(503);
  expect(storeYCloudDeliveryEvent).not.toHaveBeenCalled();
});
it('rejects unsigned requests without storage', async () => {
  expect((await POST(request(false))).status).toBe(400);
  expect(storeYCloudDeliveryEvent).not.toHaveBeenCalled();
});
it('rejects wrong accounts', async () => {
  process.env.YCLOUD_WABA_ID = 'other';
  expect((await POST(request())).status).toBe(400);
  expect(storeYCloudDeliveryEvent).not.toHaveBeenCalled();
});
it('acknowledges only committed events', async () => {
  expect((await POST(request())).status).toBe(200);
  expect(storeYCloudDeliveryEvent).toHaveBeenCalledTimes(1);
});
it('returns retry status for storage failures without exposing details', async () => {
  (storeYCloudDeliveryEvent as jest.Mock).mockRejectedValue(new Error('private DB connection'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private');
});
