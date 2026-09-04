import {
  EmailAttemptStatus,
  EmailDeliveryStatus,
  EmailNotificationStatus,
  Prisma,
} from '@prisma/client';
import { db } from '@/lib/db';
import { refreshEmailNotificationAggregateInTransaction } from '@/lib/email/email-delivery-status';
import {
  asEmailProviderFailure,
  EmailProviderFailureKind,
  type EmailProvider,
} from '@/lib/email/email-provider';
import { createResendEmailProvider } from '@/lib/email/resend-email-provider';
import { getEmailSettings } from '@/lib/email/email-settings';
import type { EmailProviderSendInput } from '@/lib/email/email-types';
import { runInTransaction } from '@/lib/transaction';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

type FrozenDelivery = {
  id: string;
  notificationId: string;
  senderName: string;
  senderAddress: string;
  replyToAddress: string | null;
  actualTo: Prisma.JsonValue;
  actualCc: Prisma.JsonValue;
  subject: string;
  htmlBody: string;
  textBody: string;
  idempotencyKey: string;
  claimToken: string | null;
};

function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function providerInput(delivery: FrozenDelivery): EmailProviderSendInput {
  return {
    notificationId: delivery.notificationId,
    senderName: delivery.senderName,
    senderAddress: delivery.senderAddress,
    replyToAddress: delivery.replyToAddress,
    to: jsonStringArray(delivery.actualTo),
    cc: jsonStringArray(delivery.actualCc),
    subject: delivery.subject,
    html: delivery.htmlBody,
    text: delivery.textBody,
    idempotencyKey: delivery.idempotencyKey,
  };
}

async function claimDelivery(
  deliveryId: string,
  input: { workerId: string; now: Date; leaseMs: number },
) {
  return runInTransaction(async (tx) => {
    const claimToken = `${input.workerId}:${deliveryId}:${input.now.getTime()}`;
    const claimExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed = await tx.emailDelivery.updateMany({
      where: {
        id: deliveryId,
        notification: {
          status: { in: [EmailNotificationStatus.QUEUED, EmailNotificationStatus.SENDING] },
        },
        OR: [
          {
            status: EmailDeliveryStatus.QUEUED,
            nextAttemptAt: { lte: input.now },
          },
          {
            status: EmailDeliveryStatus.SENDING,
            claimExpiresAt: { lte: input.now },
          },
        ],
      },
      data: {
        status: EmailDeliveryStatus.SENDING,
        claimToken,
        claimExpiresAt,
      },
    });
    if (claimed.count !== 1) return null;

    const delivery = await tx.emailDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.claimToken !== claimToken) return null;
    const previousAttempts = await tx.emailDeliveryAttempt.count({ where: { deliveryId } });
    const attempt = await tx.emailDeliveryAttempt.create({
      data: {
        deliveryId,
        attemptNo: previousAttempts + 1,
        status: EmailAttemptStatus.STARTED,
        idempotencyKey: delivery.idempotencyKey,
      },
    });
    await tx.emailNotification.update({
      where: { id: delivery.notificationId },
      data: { status: EmailNotificationStatus.SENDING },
    });
    return { delivery: delivery as FrozenDelivery, attemptId: attempt.id, attemptNo: previousAttempts + 1 };
  });
}

async function finishAccepted(input: {
  claim: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>;
  providerMessageId: string;
  now: Date;
}) {
  return runInTransaction(async (tx) => {
    await tx.emailDeliveryAttempt.update({
      where: { id: input.claim.attemptId },
      data: {
        status: EmailAttemptStatus.ACCEPTED,
        providerMessageId: input.providerMessageId,
        responseMetadata: { providerAccepted: true },
        finishedAt: input.now,
      },
    });
    const updated = await tx.emailDelivery.updateMany({
      where: { id: input.claim.delivery.id, claimToken: input.claim.delivery.claimToken },
      data: {
        status: EmailDeliveryStatus.SENT,
        providerMessageId: input.providerMessageId,
        acceptedAt: input.now,
        claimToken: null,
        claimExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (updated.count !== 1) throw new Error('Email delivery claim changed before acceptance was recorded');
    await refreshEmailNotificationAggregateInTransaction(tx, input.claim.delivery.notificationId);
  });
}

async function finishFailure(input: {
  claim: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>;
  failure: ReturnType<typeof asEmailProviderFailure>;
  retryLimit: number;
  retryIntervalsSeconds: number[];
  now: Date;
}) {
  return runInTransaction(async (tx) => {
    const uncertain = input.failure.kind === EmailProviderFailureKind.UNCERTAIN;
    const retryable = !uncertain && input.claim.attemptNo < input.retryLimit;
    const nextAttemptAt = retryable
      ? new Date(input.now.getTime() + (input.retryIntervalsSeconds[input.claim.attemptNo - 1] || 60) * 1000)
      : null;
    await tx.emailDeliveryAttempt.update({
      where: { id: input.claim.attemptId },
      data: {
        status: uncertain ? EmailAttemptStatus.UNCERTAIN : EmailAttemptStatus.REJECTED,
        failureCode: input.failure.code,
        failureMessage: input.failure.message,
        finishedAt: input.now,
      },
    });
    const status = uncertain
      ? EmailDeliveryStatus.DELIVERY_UNCERTAIN
      : retryable
        ? EmailDeliveryStatus.QUEUED
        : EmailDeliveryStatus.FAILED;
    const updated = await tx.emailDelivery.updateMany({
      where: { id: input.claim.delivery.id, claimToken: input.claim.delivery.claimToken },
      data: {
        status,
        claimToken: null,
        claimExpiresAt: null,
        nextAttemptAt,
        lastErrorCode: input.failure.code,
        lastErrorMessage: input.failure.message,
      },
    });
    if (updated.count !== 1) throw new Error('Email delivery claim changed before failure was recorded');
    await refreshEmailNotificationAggregateInTransaction(tx, input.claim.delivery.notificationId);
    return { uncertain, retryable };
  });
}

export async function dispatchQueuedEmailDeliveries(input: {
  workerId: string;
  limit: number;
  now?: Date;
  leaseMs?: number;
  provider?: EmailProvider;
}) {
  const now = input.now || new Date();
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 1)));
  const leaseMs = Math.max(30_000, input.leaseMs || DEFAULT_LEASE_MS);
  const settings = await getEmailSettings();
  if (!settings.outboundEnabled) {
    return {
      disabled: true,
      candidates: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      requeued: 0,
      uncertain: 0,
    };
  }
  if (!input.provider && !process.env.RESEND_API_KEY?.trim()) {
    return {
      disabled: false,
      configMissing: true,
      candidates: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      requeued: 0,
      uncertain: 0,
    };
  }
  const provider = input.provider || createResendEmailProvider(process.env.RESEND_API_KEY || '');
  const candidates = await db.emailDelivery.findMany({
    where: {
      notification: {
        status: { in: [EmailNotificationStatus.QUEUED, EmailNotificationStatus.SENDING] },
      },
      OR: [
        { status: EmailDeliveryStatus.QUEUED, nextAttemptAt: { lte: now } },
        { status: EmailDeliveryStatus.SENDING, claimExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true },
  });

  const result = {
    disabled: false,
    candidates: candidates.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    requeued: 0,
    uncertain: 0,
  };
  for (const candidate of candidates) {
    const claim = await claimDelivery(candidate.id, { workerId: input.workerId, now, leaseMs });
    if (!claim) continue;
    result.claimed += 1;
    try {
      const accepted = await provider.send(providerInput(claim.delivery));
      await finishAccepted({ claim, providerMessageId: accepted.providerMessageId, now });
      result.sent += 1;
    } catch (error) {
      const failure = asEmailProviderFailure(error);
      const outcome = await finishFailure({
        claim,
        failure,
        retryLimit: settings.retryLimit,
        retryIntervalsSeconds: settings.retryIntervalsSeconds,
        now,
      });
      result.failed += 1;
      if (outcome.retryable) result.requeued += 1;
      if (outcome.uncertain) result.uncertain += 1;
    }
  }
  return result;
}
