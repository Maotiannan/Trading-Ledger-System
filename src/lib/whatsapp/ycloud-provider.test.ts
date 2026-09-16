/** @jest-environment node */
import { createHmac } from 'node:crypto';
import { sendYCloudTemplate, verifyYCloudWebhookSignature } from './ycloud-provider';

const input = { to: '+8613619767412', templateName: 'receipt_payment', languageCode: 'en', parameters: ['INV-1'], externalId: 'delivery-1' };
const config = { apiKey: 'test-key', senderPhone: '+8613819858718' };
const rawBody = '{\n"id":"event-1"\n}';
const secret = 'test-signing-secret';
const timestamp = Math.floor(Date.now() / 1000);
function sign(body = rawBody, t = timestamp) {
  return 't=' + t + ',s=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');
}

describe('YCloud protocol contract', () => {
  it('uses API key auth, E.164 sender and correlation ID, not unverified provider idempotency', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'ycloud-1' })));
    await expect(sendYCloudTemplate(input, { ...config, fetchImpl })).resolves.toEqual({ providerMessageId: 'ycloud-1' });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.ycloud.com/v2/whatsapp/messages');
    expect(request.headers).toEqual({ 'X-API-Key': 'test-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(request.body)).toMatchObject({ from: config.senderPhone, externalId: 'delivery-1', filterUnsubscribed: true, filterBlocked: true });
    expect(request.redirect).toBe('error');
    expect(request.signal).toBeDefined();
  });
  it.each([200, 502])('treats unreadable HTTP %s responses as uncertain', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('not JSON', { status }));
    await expect(sendYCloudTemplate(input, { ...config, fetchImpl })).rejects.toMatchObject({ kind: 'UNCERTAIN' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('classifies a clear rejection without exposing provider diagnostics', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{"error":{"message":"test-key"}}', { status: 400 }));
    await expect(sendYCloudTemplate(input, { ...config, fetchImpl })).rejects.toMatchObject({ kind: 'REJECTED', message: 'WhatsApp provider rejected the request.' });
  });
  it('rejects invalid sender configuration before network access', async () => {
    const fetchImpl = jest.fn();
    await expect(sendYCloudTemplate(input, { ...config, senderPhone: '114138258370305', fetchImpl })).rejects.toMatchObject({ kind: 'REJECTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('verifies timestamp plus untouched raw body', () => {
    expect(verifyYCloudWebhookSignature({ rawBody, signature: sign(), secret })).toBe(true);
    expect(verifyYCloudWebhookSignature({ rawBody: '{}', signature: sign(), secret })).toBe(false);
  });
  it.each([null, '', 'sha256=bad', 't=1,s=nonhex', 't=NaN,s=00'])('rejects malformed signature %s', (signature) => {
    expect(verifyYCloudWebhookSignature({ rawBody, signature, secret })).toBe(false);
  });
  it('rejects old/future requests and empty secrets', () => {
    expect(verifyYCloudWebhookSignature({ rawBody, signature: sign(rawBody, timestamp - 600), secret })).toBe(false);
    expect(verifyYCloudWebhookSignature({ rawBody, signature: sign(rawBody, timestamp + 600), secret })).toBe(false);
    expect(verifyYCloudWebhookSignature({ rawBody, signature: sign(), secret: '' })).toBe(false);
  });
});
