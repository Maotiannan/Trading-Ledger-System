import {
  EmailDeliveryStatus,
  Prisma,
} from '@prisma/client';
import { Resend } from 'resend';
import { deriveEmailNotificationStatus } from '@/lib/email/email-delivery-status';
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

async function refreshAggregate(tx: WebhookClient, notificationId: string) {
  const deliveries = await tx.emailDelivery.findMany({
    where: { notificationId },
    select: { status: true },
  });
  const status = deriveEmailNotificationStatus(deliveries.map((delivery) => delivery.status));
  if (status) {
    await tx.emailNotification.update({ where: { id: notificationId }, data: { status } });
  }
  return status;
}

export async function applyVerifiedResendWebhook(input: VerifiedWebhook) {
  return runInTransaction(async (tx) => {
    let webhookEvent: { id: string };
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
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return { duplicate: true, applied: false };
      throw error;
    }

    const providerMessageId = String(input.data.email_id || '');
    const delivery = providerMessageId
      ? await tx.emailDelivery.findUnique({ where: { providerMessageId } })
      : null;
    if (!delivery) {
      return { duplicate: false, applied: false, unknownMessage: true };
    }

    const targetStatus = STATUS_BY_EVENT[input.type];
    const latestApplied = await tx.emailWebhookEvent.findFirst({
      where: { deliveryId: delivery.id, appliedAt: { not: null } },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    const inOrder = !latestApplied || latestApplied.occurredAt <= input.occurredAt;
    const monotonic = targetStatus
      ? STATUS_RANK[targetStatus] >= STATUS_RANK[delivery.status]
      : false;
    const applied = Boolean(targetStatus && inOrder && monotonic);

    if (applied && targetStatus) {
      await tx.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: targetStatus,
          ...(targetStatus === EmailDeliveryStatus.DELIVERED ? { deliveredAt: input.occurredAt } : {}),
          ...safeErrorFields(input.type),
        },
      });
      await refreshAggregate(tx, delivery.notificationId);
    }
    await tx.emailWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        deliveryId: delivery.id,
        ...(applied ? { appliedAt: new Date() } : {}),
      },
    });
    return { duplicate: false, applied, unknownMessage: false };
  });
}
