import { NextResponse } from 'next/server';
import { verifyYCloudWebhookSignature } from '@/lib/whatsapp/ycloud-provider';
import { logger } from '@/lib/logger';
import { parseYCloudDeliveryEvent, storeYCloudDeliveryEvent } from '@/lib/whatsapp/ycloud-webhook-storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.YCLOUD_WEBHOOK_SECRET?.trim();
  const wabaId = process.env.YCLOUD_WABA_ID?.trim();
  const senderPhone = process.env.YCLOUD_SENDER_PHONE?.trim();
  if (!secret || !wabaId || !senderPhone || process.env.WHATSAPP_WEBHOOK_ENABLED !== 'true') {
    return NextResponse.json({ success: false, code: 'WHATSAPP_WEBHOOK_NOT_CONFIGURED' }, { status: 503 });
  }
  const rawBody = await request.text();
  if (!verifyYCloudWebhookSignature({
    rawBody,
    signature: request.headers.get('YCloud-Signature') || request.headers.get('x-ycloud-signature'),
    secret,
  })) {
    logger.warn('Rejected YCloud webhook', { code: 'INVALID_WEBHOOK_SIGNATURE' });
    return NextResponse.json({ success: false, error: 'Invalid webhook signature.' }, { status: 400 });
  }

  let event: ReturnType<typeof parseYCloudDeliveryEvent>;
  try {
    event = parseYCloudDeliveryEvent(rawBody, { wabaId, senderPhone });
  } catch {
    return NextResponse.json({ success: false, code: 'INVALID_WHATSAPP_EVENT' }, { status: 400 });
  }
  try {
    const data = await storeYCloudDeliveryEvent(event);
    return NextResponse.json({ success: true, data });
  } catch {
    logger.error('YCloud webhook storage failed', { code: 'WHATSAPP_WEBHOOK_STORAGE_FAILED', providerEventId: event.id });
    return NextResponse.json({ success: false, code: 'WHATSAPP_WEBHOOK_STORAGE_FAILED' }, { status: 503 });
  }
}
