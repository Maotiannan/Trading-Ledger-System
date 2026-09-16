import crypto from 'node:crypto';

export type WhatsAppSendInput = {
  to: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
  externalId: string;
};

export type WhatsAppSendResult = { providerMessageId: string };

export class WhatsAppProviderError extends Error {
  constructor(
    public readonly kind: 'REJECTED' | 'UNCERTAIN',
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WhatsAppProviderError';
  }
}

export async function sendYCloudTemplate(
  input: WhatsAppSendInput,
  config: { apiKey: string; senderPhone: string; fetchImpl?: typeof fetch },
): Promise<WhatsAppSendResult> {
  if (!config.apiKey.trim() || !/^\+[1-9]\d{1,14}$/.test(config.senderPhone)
    || !/^\+[1-9]\d{1,14}$/.test(input.to) || !input.externalId.trim()) {
    throw new WhatsAppProviderError('REJECTED', 'INVALID_CONFIGURATION', 'Invalid WhatsApp sending configuration.');
  }
  const fetchImpl = config.fetchImpl || fetch;
  let response: Response;
  let data: unknown;
  try {
    response = await fetchImpl('https://api.ycloud.com/v2/whatsapp/messages', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.senderPhone,
        // Correlation only: YCloud does not document deduplication for this field.
        externalId: input.externalId,
        filterUnsubscribed: true,
        filterBlocked: true,
        to: input.to,
        type: 'template',
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          components: input.parameters.length
            ? [{ type: 'body', parameters: input.parameters.map((text) => ({ type: 'text', text })) }]
            : undefined,
        },
      }),
    });
    data = await response.json();
  } catch {
    throw new WhatsAppProviderError('UNCERTAIN', 'TRANSPORT_UNCERTAIN', 'WhatsApp provider response was not confirmed.');
  }

  if (!response.ok) {
    const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
    throw new WhatsAppProviderError(rejected ? 'REJECTED' : 'UNCERTAIN', 'PROVIDER_HTTP_ERROR', 'WhatsApp provider rejected the request.');
  }
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !data.id.trim()) {
    throw new WhatsAppProviderError('UNCERTAIN', 'INVALID_RESPONSE', 'WhatsApp provider response was not confirmed.');
  }
  return { providerMessageId: data.id };
}

export function verifyYCloudWebhookSignature(input: {
  rawBody: string;
  signature: string | null;
  secret: string;
}): boolean {
  if (!input.signature || !input.secret.trim()) return false;
  const fields = input.signature.split(',').map((part) => part.trim());
  const timestamps = fields.filter((part) => part.startsWith('t='));
  const signatures = fields.filter((part) => part.startsWith('s='));
  if (timestamps.length !== 1 || signatures.length !== 1) return false;
  const timestamp = timestamps[0].slice(2);
  const provided = signatures[0].slice(2);
  if (!/^\d+$/.test(timestamp) || !/^[a-fA-F0-9]{64}$/.test(provided)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', input.secret).update(timestamp + '.' + input.rawBody).digest();
  return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), expected);
}
