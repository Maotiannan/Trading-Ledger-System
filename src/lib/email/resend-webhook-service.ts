import {
  EmailDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { Resend } from 'resend';
import { refreshEmailNotificationAggregateInTransaction } from '@/lib/email/email-delivery-status';
import { db } from '@/lib/db';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

type WebhookClient = Pick<
  DbTransactionClient,
  'emailWebhookEvent' | 'emailDelivery' | 'emailNotification'
>;

type WebhookVerifier = {
  verify(input: {
    payload: string;
    headers: { id: string; timestamp: string; signature: string };
    webhookSecret: string;
  }): unknown;
};

type VerifiedWebhook = {
  providerEventId: string;
  type: string;
  data: Record<string, unknown>;
  occurredAt: Date;
};

type StoredWebhookEvent = {
  id: string;
  providerMessageId: string;
  eventType: string;
  occurredAt: Date;
  deliveryId: string | null;
  appliedAt: Date | null;
};

type WebhookDelivery = {
  id: string;
  notificationId: string;
  status: EmailDeliveryStatus;
};

const STATUS_BY_EVENT: Record<string, EmailDeliveryStatus | undefined> = {
  'email.sent': EmailDeliveryStatus.SENT,
  'email.delivered': EmailDeliveryStatus.DELIVERED,
  'email.delivery_delayed': EmailDeliveryStatus.DELIVERY_DELAYED,
  'email.bounced': EmailDeliveryStatus.BOUNCED,
  'email.complained': EmailDeliveryStatus.COMPLAINED,
  'email.suppressed': EmailDeliveryStatus.SUPPRESSED,
  'email.failed': EmailDeliveryStatus.FAILED,
};

const STATUS_RANK: Record<EmailDeliveryStatus, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERY_DELAYED: 3,
  FAILED: 4,
  DELIVERED: 5,
  BOUNCED: 6,
  COMPLAINED: 6,
  SUPPRESSED: 6,
  DELIVERY_UNCERTAIN: 6,
  CANCELLED: 6,
};

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Resend webhook payload.');
  }
  return value as Record<string, unknown>;
}

export function verifyResendWebhookPayload(input: {
  payload: string;
  headers: { id: string; timestamp: string; signature: string };
  webhookSecret: string;
  verifier?: WebhookVerifier;
}): VerifiedWebhook {
  const verifier = input.verifier || (new Resend().webhooks as unknown as WebhookVerifier);
  let verified: Record<string, unknown>;
  try {
    verified = recordValue(verifier.verify({
      payload: input.payload,
      headers: input.headers,
      webhookSecret: input.webhookSecret,
    }));
  } catch {
    throw new Error('Invalid Resend webhook signature.');
  }
  const occurredAt = new Date(String(verified.created_at || ''));
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid Resend webhook payload.');
  return {
    providerEventId: input.headers.id,
    type: String(verified.type || ''),
    data: recordValue(verified.data),
    occurredAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function safeErrorFields(type: string): { lastErrorCode: string | null; lastErrorMessage: string | null } {
  if (type === 'email.bounced') return { lastErrorCode: 'RESEND_BOUNCED', lastErrorMessage: 'Recipient server bounced the email.' };
  if (type === 'email.complained') return { lastErrorCode: 'RESEND_COMPLAINED', lastErrorMessage: 'Recipient reported the email as spam.' };
  if (type === 'email.suppressed') return { lastErrorCode: 'RESEND_SUPPRESSED', lastErrorMessage: 'Email provider suppressed the recipient.' };
  if (type === 'email.failed') return { lastErrorCode: 'RESEND_FAILED', lastErrorMessage: 'Email provider reported delivery failure.' };
  return { lastErrorCode: null, lastErrorMessage: null };
}

const WEBHOOK_EVENT_SELECT = {
  id: true,
  providerMessageId: true,
  eventType: true,
  occurredAt: true,
  deliveryId: true,
  appliedAt: true,
} as const;

async function applyStoredWebhookEvent(
  tx: WebhookClient,
  event: StoredWebhookEvent,
): Promise<{ applied: boolean; unknownMessage: boolean }> {
  if (event.deliveryId || event.appliedAt) {
    return { applied: false, unknownMessage: false };
  }

  const delivery = event.providerMessageId
    ? await tx.emailDelivery.findUnique({ where: { providerMessageId: event.providerMessageId } })
    : null;
  if (!delivery) return { applied: false, unknownMessage: true };

  const claimed = await tx.emailWebhookEvent.updateMany({
    where: { id: event.id, deliveryId: null, appliedAt: null },
    data: { deliveryId: delivery.id },
  });
  if (claimed.count !== 1) return { applied: false, unknownMessage: false };

  const targetStatus = STATUS_BY_EVENT[event.eventType];
  const latestApplied = await tx.emailWebhookEvent.findFirst({
    where: { deliveryId: delivery.id, appliedAt: { not: null } },
    orderBy: { occurredAt: 'desc' },
    select: { occurredAt: true },
  });
  const inOrder = !latestApplied || latestApplied.occurredAt <= event.occurredAt;
  const monotonic = targetStatus
    ? STATUS_RANK[targetStatus] >= STATUS_RANK[(delivery as WebhookDelivery).status]
    : false;
  const applied = Boolean(targetStatus && inOrder && monotonic);

  if (applied && targetStatus) {
    await tx.emailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: targetStatus,
        ...(targetStatus === EmailDeliveryStatus.DELIVERED ? { deliveredAt: event.occurredAt } : {}),
        ...safeErrorFields(event.eventType),
      },
    });
    await refreshEmailNotificationAggregateInTransaction(tx, delivery.notificationId);
    await tx.emailWebhookEvent.update({
      where: { id: event.id },
      data: { appliedAt: new Date() },
    });
  }
  return { applied, unknownMessage: false };
}

export async function applyVerifiedResendWebhook(input: VerifiedWebhook) {
  return runInTransaction(async (tx) => {
    let webhookEvent: StoredWebhookEvent;
    try {
      webhookEvent = await tx.emailWebhookEvent.create({
        data: {
          providerEventId: input.providerEventId,
          providerMessageId: String(input.data.email_id || ''),
          eventType: input.type,
          payload: {
            type: input.type,
            data: input.data,
            occurredAt: input.occurredAt.toISOString(),
          } as Prisma.InputJsonValue,
          occurredAt: input.occurredAt,
        },
        select: WEBHOOK_EVENT_SELECT,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await tx.emailWebhookEvent.findUnique({
          where: { providerEventId: input.providerEventId },
          select: WEBHOOK_EVENT_SELECT,
        });
        if (!existing) throw error;
        const outcome = await applyStoredWebhookEvent(tx, existing);
        return { duplicate: true, ...outcome };
      }
      throw error;
    }
    const outcome = await applyStoredWebhookEvent(tx, webhookEvent);
    return { duplicate: false, ...outcome };
  });
}
