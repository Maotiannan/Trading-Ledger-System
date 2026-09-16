import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dispatchWhatsAppDelivery } from '@/lib/whatsapp/whatsapp-dispatch';
import { projectWhatsAppBusinessEvents } from '@/lib/whatsapp/whatsapp-business-projector';
import { parseYCloudDeliveryEvent, storeYCloudDeliveryEvent } from '@/lib/whatsapp/ycloud-webhook-storage';
import { logger } from '@/lib/logger';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const token = process.env.MAINTENANCE_JOB_TOKEN || '';
  const candidate = request.headers.get('x-maintenance-token') || '';
  if (!token || Buffer.byteLength(token) !== Buffer.byteLength(candidate) || !timingSafeEqual(Buffer.from(token), Buffer.from(candidate))) {
    return NextResponse.json({ success: false }, { status: 401 });
  }
  if (process.env.WHATSAPP_OUTBOUND_ENABLED !== 'true') return NextResponse.json({ success: true, disabled: true });
  try {
    await projectWhatsAppBusinessEvents();
    await db.whatsAppDelivery.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: new Date(Date.now() - 120000) } },
      data: { status: 'UNCERTAIN', failureCode: 'CLAIM_EXPIRED' },
    });
    const events = await db.whatsAppWebhookEvent.findMany({ where: { appliedAt: null }, orderBy: { receivedAt: 'asc' }, take: 50 });
    for (const event of events) {
      try {
        await storeYCloudDeliveryEvent(parseYCloudDeliveryEvent(JSON.stringify({
          id: event.providerEventId, type: event.eventType, createTime: event.occurredAt.toISOString(), whatsappMessage: event.payload,
        }), { wabaId: process.env.YCLOUD_WABA_ID || '', senderPhone: process.env.YCLOUD_SENDER_PHONE || '' }));
      } catch { logger.warn('WhatsApp callback replay deferred', { eventId: event.id }); }
    }
    const settings = await import('@/lib/whatsapp/whatsapp-settings').then(module => module.getWhatsAppSettings());
    const rows = await db.whatsAppDelivery.findMany({ where: { status: 'QUEUED', testMode: settings.testMode }, orderBy: { createdAt: 'asc' }, take: 10, select: { id: true } });
    let accepted = 0;
    for (const row of rows) {
      try { if ((await dispatchWhatsAppDelivery(row.id)).sent) accepted++; }
      catch { logger.error('WhatsApp delivery processing deferred', { deliveryId: row.id }); }
    }
    return NextResponse.json({ success: true, accepted });
  } catch {
    logger.error('WhatsApp dispatch failed', { code: 'WHATSAPP_DISPATCH_FAILED' });
    return NextResponse.json({ success: false }, { status: 503 });
  }
}
