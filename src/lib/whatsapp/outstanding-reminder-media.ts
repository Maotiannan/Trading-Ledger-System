import type { WhatsAppDelivery } from '@prisma/client';
import { db } from '@/lib/db';
import type { DashboardCustomerOutstanding } from '@/lib/dashboard-customer-outstanding';
import { renderOutstandingStatementPng } from '@/lib/customer-outstanding-statement-server';
import { saveUploadedImage } from '@/lib/upload';

export async function prepareReminderMedia(delivery: WhatsAppDelivery, config: { apiKey: string; senderPhone: string }) {
  const snapshot = delivery.businessSnapshot as unknown as { outstanding: DashboardCustomerOutstanding; statementDate: string };
  const png = await renderOutstandingStatementPng(snapshot.outstanding, new Date(snapshot.statementDate));
  const file = new File([new Uint8Array(png)], `${delivery.id}-outstanding-fr.png`, { type: 'image/png' });
  const saved = await saveUploadedImage(file, { subDir: 'whatsapp-statements' });
  const updated = await db.whatsAppDelivery.updateMany({ where: { id: delivery.id, claimToken: delivery.claimToken, status: 'SENDING' },
    data: { statementImagePath: saved.path } });
  if (updated.count !== 1) throw new Error('Reminder claim is no longer valid.');
  const form = new FormData();
  form.set('file', file);
  const response = await fetch(`https://api.ycloud.com/v2/whatsapp/media/${encodeURIComponent(config.senderPhone)}/upload`, {
    method: 'POST', headers: { 'X-API-Key': config.apiKey }, body: form,
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('WhatsApp media upload rejected.');
  const result = await response.json();
  if (typeof result.id !== 'string' || !result.id.trim()) throw new Error('WhatsApp media upload not confirmed.');
  return result.id as string;
}
