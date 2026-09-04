import {
  EmailDeliveryStatus,
  EmailNotificationStatus,
} from '@prisma/client';
import { db } from '@/lib/db';
import {
  applyVerifiedResendWebhook,
  verifyResendWebhookPayload,
} from '@/lib/email/resend-webhook-service';

jest.mock('resend', () => ({ Resend: jest.fn() }));

jest.mock('@/lib/db', () => ({
  db: {
    emailWebhookEvent: {},
    emailDelivery: {},
    emailNotification: {},
  },
}));

let mockTransactionClient: Record<string, unknown>;
jest.mock('@/lib/transaction', () => ({
  runInTransaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockTransactionClient)),
}));

function makeWebhookState() {
  const delivery = {
    id: 'delivery-1',
    notificationId: 'notification-1',
    providerMessageId: 'resend-1',
    status: EmailDeliveryStatus.SENT,
    deliveredAt: null as Date | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
  };
  const events: Array<Record<string, unknown>> = [];
  let notificationStatus: EmailNotificationStatus = EmailNotificationStatus.SENT;
  const emailWebhookEvent = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (events.some((row) => row.providerEventId === data.providerEventId)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const row = {
        id: `event-${events.length + 1}`,
        deliveryId: null,
        appliedAt: null,
        ...data,
      };
      events.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }: { where: { id?: string; providerEventId?: string } }) => (
      events.find((row) => (
        (where.id && row.id === where.id)
        || (where.providerEventId && row.providerEventId === where.providerEventId)
      )) || null
    )),
    findFirst: jest.fn(async ({ where }: { where: { deliveryId: string } }) => (
      [...events]
        .filter((row) => row.deliveryId === where.deliveryId && row.appliedAt)
        .sort((a, b) => Number(new Date(String(b.occurredAt))) - Number(new Date(String(a.occurredAt))))[0] || null
    )),
    updateMany: jest.fn(async ({ where, data }: {
      where: { id: string; deliveryId?: string | null; appliedAt?: null };
      data: Record<string, unknown>;
    }) => {
      const row = events.find((candidate) => candidate.id === where.id);
      if (!row) return { count: 0 };
      if ('deliveryId' in where && (row.deliveryId ?? null) !== where.deliveryId) return { count: 0 };
      if ('appliedAt' in where && (row.appliedAt ?? null) !== where.appliedAt) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = events.find((candidate) => candidate.id === where.id);
      Object.assign(row!, data);
      return row;
    }),
  };
  const emailDelivery = {
    findUnique: jest.fn(async ({ where }: { where: { providerMessageId: string } }) => (
      where.providerMessageId === delivery.providerMessageId ? delivery : null
    )),
    findMany: jest.fn(async () => [delivery]),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(delivery, data);
      return delivery;
    }),
  };
  const emailNotification = {
    updateMany: jest.fn(async ({ where, data }: {
      where: { id: string; status?: { notIn?: EmailNotificationStatus[] } };
      data: { status: EmailNotificationStatus };
    }) => {
      if (where.id !== 'notification-1') return { count: 0 };
      if (where.status?.notIn?.includes(notificationStatus)) return { count: 0 };
      notificationStatus = data.status;
      return { count: 1 };
    }),
    update: jest.fn(async ({ data }: { data: { status: EmailNotificationStatus } }) => {
      notificationStatus = data.status;
      return { id: 'notification-1', status: data.status };
    }),
  };
  return {
    client: { emailWebhookEvent, emailDelivery, emailNotification },
    delivery,
    events,
    get notificationStatus() { return notificationStatus; },
  };
}

const mockDb = db as unknown as Record<string, unknown>;

function event(
  type: string,
  providerEventId: string,
  occurredAt = new Date('2026-09-01T02:00:00.000Z'),
) {
  return {
    providerEventId,
    type,
    data: { email_id: 'resend-1' },
    occurredAt,
  };
}

describe('resend-webhook-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
  });

  it('passes the raw payload and all Svix headers to the verifier', () => {
    const verify = jest.fn().mockReturnValue({
      type: 'email.sent',
      created_at: '2026-09-01T02:00:00.000Z',
      data: { email_id: 'resend-1' },
    });

    expect(verifyResendWebhookPayload({
      payload: '{"type":"email.sent"}',
      headers: { id: 'svix-1', timestamp: '123', signature: 'v1,signature' },
      webhookSecret: 'whsec_test',
      verifier: { verify },
    })).toMatchObject({ providerEventId: 'svix-1', type: 'email.sent' });
    expect(verify).toHaveBeenCalledWith({
      payload: '{"type":"email.sent"}',
      headers: { id: 'svix-1', timestamp: '123', signature: 'v1,signature' },
      webhookSecret: 'whsec_test',
    });
  });

  it('rejects invalid signatures without returning secret diagnostics', () => {
    const verify = jest.fn(() => { throw new Error('signature secret leaked'); });

    expect(() => verifyResendWebhookPayload({
      payload: '{}',
      headers: { id: 'svix-1', timestamp: '123', signature: 'bad' },
      webhookSecret: 'whsec_secret',
      verifier: { verify },
    })).toThrow('Invalid Resend webhook signature.');
  });

  it('deduplicates provider event IDs without reapplying', async () => {
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await applyVerifiedResendWebhook(event('email.delivered', 'svix-1'));
    await expect(applyVerifiedResendWebhook(event('email.delivered', 'svix-1'))).resolves.toMatchObject({ duplicate: true });

    expect(state.client.emailDelivery.update).toHaveBeenCalledTimes(1);
    expect(state.events).toHaveLength(1);
  });

  it('stores an unknown provider message ID without changing a delivery', async () => {
    const state = makeWebhookState();
    state.delivery.providerMessageId = 'another-message';
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(applyVerifiedResendWebhook(event('email.sent', 'svix-unknown'))).resolves.toMatchObject({
      unknownMessage: true,
    });
    expect(state.client.emailDelivery.update).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(1);
  });

  it('reconciles a previously unknown provider message when Resend retries the same event', async () => {
    const state = makeWebhookState();
    state.delivery.providerMessageId = 'not-persisted-yet';
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(applyVerifiedResendWebhook(event('email.delivered', 'svix-early'))).resolves.toMatchObject({
      unknownMessage: true,
    });
    state.delivery.providerMessageId = 'resend-1';

    await expect(applyVerifiedResendWebhook(event('email.delivered', 'svix-early'))).resolves.toMatchObject({
      duplicate: true,
      applied: true,
      unknownMessage: false,
    });
    expect(state.delivery.status).toBe(EmailDeliveryStatus.DELIVERED);
    expect(state.events).toHaveLength(1);
  });

  it('applies delivered status and never regresses it with a late sent event', async () => {
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await applyVerifiedResendWebhook(event('email.delivered', 'svix-delivered'));
    await applyVerifiedResendWebhook(event(
      'email.sent',
      'svix-old-sent',
      new Date('2026-09-01T01:00:00.000Z'),
    ));

    expect(state.delivery.status).toBe(EmailDeliveryStatus.DELIVERED);
    expect(state.notificationStatus).toBe(EmailNotificationStatus.DELIVERED);
  });

  it('does not regress a delivered email to failed even when the failed event arrives later', async () => {
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await applyVerifiedResendWebhook(event('email.delivered', 'svix-delivered'));
    await applyVerifiedResendWebhook(event(
      'email.failed',
      'svix-failed',
      new Date('2026-09-01T03:00:00.000Z'),
    ));

    expect(state.delivery.status).toBe(EmailDeliveryStatus.DELIVERED);
    expect(state.notificationStatus).toBe(EmailNotificationStatus.DELIVERED);
  });

  it('does not let an unsupported event block an earlier valid delivery event', async () => {
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await applyVerifiedResendWebhook(event(
      'email.provider_new_event',
      'svix-unsupported',
      new Date('2026-09-01T04:00:00.000Z'),
    ));
    await applyVerifiedResendWebhook(event(
      'email.bounced',
      'svix-bounced',
      new Date('2026-09-01T03:00:00.000Z'),
    ));

    expect(state.delivery.status).toBe(EmailDeliveryStatus.BOUNCED);
    expect(state.notificationStatus).toBe(EmailNotificationStatus.BOUNCED);
  });

  it.each([
    ['email.delivery_delayed', EmailDeliveryStatus.DELIVERY_DELAYED],
    ['email.bounced', EmailDeliveryStatus.BOUNCED],
    ['email.complained', EmailDeliveryStatus.COMPLAINED],
    ['email.suppressed', EmailDeliveryStatus.SUPPRESSED],
    ['email.failed', EmailDeliveryStatus.FAILED],
  ])('maps %s to %s', async (type, status) => {
    const state = makeWebhookState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await applyVerifiedResendWebhook(event(type, `svix-${type}`));

    expect(state.delivery.status).toBe(status);
  });
});
