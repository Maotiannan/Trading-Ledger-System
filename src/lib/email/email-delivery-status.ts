import {
  EmailDeliveryStatus,
  EmailNotificationStatus,
} from '@prisma/client';
import type { DbTransactionClient } from '@/lib/transaction';

type AggregateClient = Pick<DbTransactionClient, 'emailDelivery' | 'emailNotification'>;

const SOURCE_OVERRIDE_STATUSES = [
  EmailNotificationStatus.CANCELLED,
  EmailNotificationStatus.NEEDS_CORRECTION,
];

const SUCCESS_OR_PROVIDER_TERMINAL = new Set<EmailDeliveryStatus>([
  EmailDeliveryStatus.SENT,
  EmailDeliveryStatus.DELIVERED,
  EmailDeliveryStatus.DELIVERY_DELAYED,
  EmailDeliveryStatus.BOUNCED,
  EmailDeliveryStatus.COMPLAINED,
  EmailDeliveryStatus.SUPPRESSED,
]);

export function deriveEmailNotificationStatus(
  statuses: EmailDeliveryStatus[],
): EmailNotificationStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.includes(EmailDeliveryStatus.DELIVERY_UNCERTAIN)) {
    return EmailNotificationStatus.DELIVERY_UNCERTAIN;
  }
  if (statuses.includes(EmailDeliveryStatus.SENDING)) return EmailNotificationStatus.SENDING;
  if (statuses.includes(EmailDeliveryStatus.QUEUED)) return EmailNotificationStatus.QUEUED;
  if (statuses.includes(EmailDeliveryStatus.COMPLAINED)) return EmailNotificationStatus.COMPLAINED;
  if (statuses.includes(EmailDeliveryStatus.BOUNCED)) return EmailNotificationStatus.BOUNCED;
  if (statuses.includes(EmailDeliveryStatus.SUPPRESSED)) return EmailNotificationStatus.SUPPRESSED;

  const failedCount = statuses.filter((status) => status === EmailDeliveryStatus.FAILED).length;
  if (failedCount > 0) {
    return statuses.some((status) => SUCCESS_OR_PROVIDER_TERMINAL.has(status))
      ? EmailNotificationStatus.PARTIALLY_SENT
      : EmailNotificationStatus.FAILED;
  }
  if (statuses.every((status) => status === EmailDeliveryStatus.CANCELLED)) {
    return EmailNotificationStatus.CANCELLED;
  }
  if (statuses.includes(EmailDeliveryStatus.DELIVERY_DELAYED)) {
    return EmailNotificationStatus.DELIVERY_DELAYED;
  }
  if (statuses.every((status) => status === EmailDeliveryStatus.DELIVERED)) {
    return EmailNotificationStatus.DELIVERED;
  }
  if (statuses.some((status) => (
    status === EmailDeliveryStatus.SENT || status === EmailDeliveryStatus.DELIVERED
  ))) {
    return EmailNotificationStatus.SENT;
  }
  return null;
}

export async function refreshEmailNotificationAggregateInTransaction(
  tx: AggregateClient,
  notificationId: string,
): Promise<EmailNotificationStatus | null> {
  const deliveries = await tx.emailDelivery.findMany({
    where: { notificationId },
    select: { status: true },
  });
  const status = deriveEmailNotificationStatus(deliveries.map((delivery) => delivery.status));
  if (!status) return null;

  const updated = await tx.emailNotification.updateMany({
    where: {
      id: notificationId,
      status: { notIn: SOURCE_OVERRIDE_STATUSES },
    },
    data: { status },
  });
  return updated.count === 1 ? status : null;
}
