import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runWhatsAppTransaction as runInTransaction } from '@/lib/whatsapp/whatsapp-transaction';
import { getWhatsAppSettings } from './whatsapp-settings';
import { renderWhatsAppSnapshot } from './whatsapp-template';
import { enqueueWhatsAppInTransaction } from './whatsapp-queue';
import { logger } from '@/lib/logger';

// Reuse persisted business-event snapshots already produced transactionally by
// receipt/invoice services. No second balance formula and no email approvals changed.
export async function projectWhatsAppBusinessEvents() {
  const settings = await getWhatsAppSettings();
  const senderPhone = process.env.YCLOUD_SENDER_PHONE;
  if (!settings.activatedAt || !senderPhone) return { projected: 0 };
  let projected = 0;
  let cursor: string | undefined;
  do {
    const events = await db.emailNotification.findMany({
      where: { createdAt: { gte: new Date(settings.activatedAt) }, customerId: { not: null }, parentNotificationId: null,
        OR: [{ correctionReason: null }, { correctionReason: { in: ['SOURCE_CHANGED', 'ADMIN_CANCELLED'] } }] },
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const event of events) {
      const contacts = await db.customerWhatsAppContact.findMany({
        where: { customerId: event.customerId!, optedInAt: { lte: event.createdAt }, optedOutAt: null },
      });
      for (const contact of contacts) {
        let rendered: ReturnType<typeof renderWhatsAppSnapshot>;
        try { rendered = renderWhatsAppSnapshot(event.type, event.currentSnapshot); }
        catch { logger.warn('WhatsApp source needs correction', { sourceId: event.id }); continue; }
        const eventKey = createHash('sha256').update(event.id + ':' + contact.id).digest('hex');
        await runInTransaction(tx => enqueueWhatsAppInTransaction(tx, {
          eventKey, type: event.type, sourceId: event.id, contactId: contact.id,
          testMode: settings.testMode, testDestination: settings.testDestination,
          senderPhone, ...rendered, businessSnapshot: event.currentSnapshot as Prisma.InputJsonObject,
        }));
        projected++;
      }
    }
    cursor = events.length === 100 ? events[events.length - 1].id : undefined;
  } while (cursor);
  return { projected };
}
