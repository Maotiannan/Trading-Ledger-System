import type { WhatsAppDelivery } from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';

export function isExplicitWhatsAppFailure(row: Pick<WhatsAppDelivery, 'status' | 'failureCode' | 'providerMessageId'>) {
  return row.status === 'FAILED' && Boolean(row.failureCode) && (Boolean(row.providerMessageId)
    || ['PROVIDER_REJECTED', 'REMINDER_IMAGE_FAILED'].includes(row.failureCode!));
}

export async function failedRetryAncestors(tx: Pick<DbTransactionClient, 'whatsAppDelivery'>, delivery: WhatsAppDelivery) {
  const ancestors: WhatsAppDelivery[] = [];
  let parentId = delivery.retryOf;
  const visited = new Set([delivery.id]);
  while (parentId) {
    if (visited.has(parentId) || ancestors.length >= 32) return null;
    visited.add(parentId);
    const parent = await tx.whatsAppDelivery.findUnique({ where: { id: parentId } });
    if (!parent || !isExplicitWhatsAppFailure(parent) || parent.type !== delivery.type
      || parent.sourceId !== delivery.sourceId || parent.testMode !== delivery.testMode) return null;
    ancestors.push(parent);
    parentId = parent.retryOf;
  }
  return ancestors;
}

// A provider GET is deliberately outside retryable database transactions.
export async function verifyFailedWhatsAppProvider(row: WhatsAppDelivery) {
  if (!isExplicitWhatsAppFailure(row)) return false;
  if (!row.providerMessageId) return true;
  if (!process.env.YCLOUD_API_KEY || !process.env.YCLOUD_WABA_ID) return false;
  try {
    const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/' + encodeURIComponent(row.providerMessageId), {
      headers: { 'X-API-Key': process.env.YCLOUD_API_KEY }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return false;
    const remote = await response.json();
    return remote.id === row.providerMessageId && remote.status === 'failed'
      && (remote.wabaId == null || remote.wabaId === process.env.YCLOUD_WABA_ID)
      && (remote.from == null || remote.from === row.senderPhone)
      && (remote.to == null || remote.to === row.actualTo);
  } catch { return false; }
}
