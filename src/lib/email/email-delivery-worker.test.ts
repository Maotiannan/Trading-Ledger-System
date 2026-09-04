import {
  EmailAttemptStatus,
  EmailDeliveryStatus,
  EmailNotificationStatus,
  EmailRecipientMode,
} from '@prisma/client';
import { db } from '@/lib/db';
import {
  EmailProviderFailure,
  EmailProviderFailureKind,
  type EmailProvider,
} from '@/lib/email/email-provider';
import { dispatchQueuedEmailDeliveries } from '@/lib/email/email-delivery-worker';
import { getEmailSettings } from '@/lib/email/email-settings';

jest.mock('resend', () => ({ Resend: jest.fn() }));

jest.mock('@/lib/db', () => ({
  db: {
    emailDelivery: {},
    emailDeliveryAttempt: {},
    emailNotification: {},
  },
}));

let mockTransactionClient: Record<string, unknown>;
jest.mock('@/lib/transaction', () => ({
  runInTransaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockTransactionClient)),
}));

jest.mock('@/lib/email/email-settings', () => ({
  getEmailSettings: jest.fn(),
}));

type Delivery = ReturnType<typeof deliveryFixture>;
type Attempt = Record<string, unknown> & {
  id: string;
  deliveryId: string;
  attemptNo: number;
  status: EmailAttemptStatus;
};

function deliveryFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    notificationId: 'notification-1',
    status: EmailDeliveryStatus.QUEUED,
    recipientMode: EmailRecipientMode.PRIMARY_CC,
    language: 'ENGLISH',
    templateVersion: 1,
    senderName: 'MU LEDGER',
    senderAddress: 'ledger@example.com',
    replyToAddress: null,
    intendedTo: ['primary@example.com'],
    intendedCc: [],
    actualTo: ['primary@example.com'],
    actualCc: [],
    subject: 'Payment received',
    htmlBody: '<p>Payment</p>',
    textBody: 'Payment',
    businessSnapshot: {},
    providerMessageId: null,
    idempotencyKey: 'email-delivery:notification-1:1',
    claimToken: null,
    claimExpiresAt: null,
    nextAttemptAt: new Date('2026-09-01T00:00:00.000Z'),
    acceptedAt: null,
    deliveredAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    notification: { id: 'notification-1', status: EmailNotificationStatus.QUEUED },
    ...overrides,
  };
}

function makeWorkerState(initialDeliveries: Delivery[] = [deliveryFixture()]) {
  const deliveries = [...initialDeliveries];
  const notifications = new Map<string, EmailNotificationStatus>(
    deliveries.map((row) => [row.notificationId, row.notification.status]),
  );
  const attempts: Attempt[] = [];
  let attemptSequence = 1;

  const deliveryMatches = (row: Delivery, where: Record<string, unknown> = {}) => {
    if (where.id && row.id !== where.id) return false;
    if (where.notificationId && row.notificationId !== where.notificationId) return false;
    if (where.claimToken && row.claimToken !== where.claimToken) return false;
    if (where.status) {
      const status = where.status as string | { in?: string[] };
      if (typeof status === 'string' && row.status !== status) return false;
      if (typeof status === 'object' && status.in && !status.in.includes(row.status)) return false;
    }
    if (Array.isArray(where.OR)) {
      const eligible = (where.OR as Array<Record<string, unknown>>).some((branch) => {
        if (branch.status && branch.status !== row.status) return false;
        const next = branch.nextAttemptAt as { lte?: Date } | undefined;
        if (next?.lte && row.nextAttemptAt && row.nextAttemptAt > next.lte) return false;
        const claim = branch.claimExpiresAt as { lte?: Date } | undefined;
        const rowClaimExpiresAt = row.claimExpiresAt as Date | null;
        if (claim?.lte && rowClaimExpiresAt && rowClaimExpiresAt > claim.lte) return false;
        return true;
      });
      if (!eligible) return false;
    }
    return true;
  };

  const emailDelivery = {
    findMany: jest.fn(async ({ where, take }: { where?: Record<string, unknown>; take?: number } = {}) => (
      deliveries.filter((row) => deliveryMatches(row, where)).slice(0, take)
    )),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (
      deliveries.find((row) => row.id === where.id) || null
    )),
    updateMany: jest.fn(async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const rows = deliveries.filter((row) => deliveryMatches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = deliveries.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('delivery missing');
      Object.assign(row, data);
      return row;
    }),
  };

  const emailDeliveryAttempt = {
    count: jest.fn(async ({ where }: { where: { deliveryId: string } }) => (
      attempts.filter((row) => row.deliveryId === where.deliveryId).length
    )),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `attempt-${attemptSequence++}`, ...data } as Attempt;
      attempts.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = attempts.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('attempt missing');
      Object.assign(row, data);
      return row;
    }),
  };

  const emailNotification = {
    updateMany: jest.fn(async ({ where, data }: {
      where: { id: string; status?: { notIn?: EmailNotificationStatus[] } };
      data: { status: EmailNotificationStatus };
    }) => {
      if (!notifications.has(where.id)) return { count: 0 };
      const currentStatus = notifications.get(where.id);
      if (where.status?.notIn?.includes(currentStatus as EmailNotificationStatus)) return { count: 0 };
      notifications.set(where.id, data.status);
      return { count: 1 };
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: { status: EmailNotificationStatus } }) => {
      notifications.set(where.id, data.status);
      return { id: where.id, status: data.status };
    }),
  };

  const client = { emailDelivery, emailDeliveryAttempt, emailNotification };
  return { client, deliveries, attempts, notifications };
}

const mockDb = db as unknown as Record<string, unknown>;
const mockGetEmailSettings = getEmailSettings as jest.Mock;
const now = new Date('2026-09-01T01:00:00.000Z');

function provider(send: EmailProvider['send']): EmailProvider {
  return { send };
}

describe('email-delivery-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    mockGetEmailSettings.mockResolvedValue({
      outboundEnabled: true,
      retryLimit: 2,
      retryIntervalsSeconds: [60, 300],
    });
  });

  it('does not claim or send queued deliveries while outbound email is disabled', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    mockGetEmailSettings.mockResolvedValue({
      outboundEnabled: false,
      retryLimit: 2,
      retryIntervalsSeconds: [60, 300],
    });
    const send = jest.fn();

    const result = await dispatchQueuedEmailDeliveries({
      workerId: 'worker-a',
      limit: 10,
      now,
      provider: provider(send),
    });

    expect(result).toMatchObject({ disabled: true, candidates: 0, claimed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.QUEUED);
    expect(state.attempts).toHaveLength(0);
  });

  it('does not claim deliveries when the provider key is missing', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const originalApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    try {
      const result = await dispatchQueuedEmailDeliveries({
        workerId: 'worker-a',
        limit: 10,
        now,
      });

      expect(result).toMatchObject({ configMissing: true, candidates: 0, claimed: 0, sent: 0 });
      expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.QUEUED);
      expect(state.attempts).toHaveLength(0);
    } finally {
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
    }
  });

  it('claims a queued delivery, records an accepted attempt, and sends only frozen fields', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockResolvedValue({ providerMessageId: 'resend-1' });

    const result = await dispatchQueuedEmailDeliveries({
      workerId: 'worker-a',
      limit: 10,
      now,
      provider: provider(send),
    });

    expect(result).toMatchObject({ claimed: 1, sent: 1, failed: 0, uncertain: 0 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      notificationId: 'notification-1',
      to: ['primary@example.com'],
      subject: 'Payment received',
      idempotencyKey: 'email-delivery:notification-1:1',
    }));
    expect(state.deliveries[0]).toMatchObject({
      status: EmailDeliveryStatus.SENT,
      providerMessageId: 'resend-1',
      claimToken: null,
    });
    expect(state.attempts[0]).toMatchObject({ status: EmailAttemptStatus.ACCEPTED });
    expect(state.notifications.get('notification-1')).toBe(EmailNotificationStatus.SENT);
  });

  it('does not overwrite a correction raised while the provider request is in flight', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockImplementation(async () => {
      state.notifications.set('notification-1', EmailNotificationStatus.NEEDS_CORRECTION);
      return { providerMessageId: 'resend-1' };
    });

    await dispatchQueuedEmailDeliveries({
      workerId: 'worker-a',
      limit: 10,
      now,
      provider: provider(send),
    });

    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.SENT);
    expect(state.notifications.get('notification-1')).toBe(EmailNotificationStatus.NEEDS_CORRECTION);
  });

  it('allows only one worker to win the same conditional claim', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockResolvedValue({ providerMessageId: 'resend-1' });

    await Promise.all([
      dispatchQueuedEmailDeliveries({ workerId: 'worker-a', limit: 10, now, provider: provider(send) }),
      dispatchQueuedEmailDeliveries({ workerId: 'worker-b', limit: 10, now, provider: provider(send) }),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(state.attempts).toHaveLength(1);
  });

  it('recovers an expired sending lease with the same delivery idempotency key', async () => {
    const state = makeWorkerState([deliveryFixture({
      status: EmailDeliveryStatus.SENDING,
      claimToken: 'dead-worker',
      claimExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
    })]);
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockResolvedValue({ providerMessageId: 'resend-recovered' });

    await dispatchQueuedEmailDeliveries({ workerId: 'worker-new', limit: 10, now, provider: provider(send) });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'email-delivery:notification-1:1',
    }));
    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.SENT);
  });

  it('requeues a definite rejection and stops after the retry cap', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const rejection = new EmailProviderFailure({
      kind: EmailProviderFailureKind.REJECTED,
      code: 'rate_limit_exceeded',
      message: 'Email provider rejected the request.',
    });
    const send = jest.fn().mockRejectedValue(rejection);

    await dispatchQueuedEmailDeliveries({ workerId: 'worker-a', limit: 10, now, provider: provider(send) });
    expect(state.deliveries[0]).toMatchObject({
      status: EmailDeliveryStatus.QUEUED,
      nextAttemptAt: new Date('2026-09-01T01:01:00.000Z'),
    });

    await dispatchQueuedEmailDeliveries({
      workerId: 'worker-b',
      limit: 10,
      now: new Date('2026-09-01T01:02:00.000Z'),
      provider: provider(send),
    });
    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.FAILED);
    expect(state.attempts).toHaveLength(2);
    expect(state.notifications.get('notification-1')).toBe(EmailNotificationStatus.FAILED);
  });

  it('marks a transport timeout uncertain and never schedules an automatic retry', async () => {
    const state = makeWorkerState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockRejectedValue(new EmailProviderFailure({
      kind: EmailProviderFailureKind.UNCERTAIN,
      code: 'TRANSPORT_UNCERTAIN',
      message: 'Email provider response was not confirmed.',
    }));

    await dispatchQueuedEmailDeliveries({ workerId: 'worker-a', limit: 10, now, provider: provider(send) });

    expect(state.deliveries[0]).toMatchObject({
      status: EmailDeliveryStatus.DELIVERY_UNCERTAIN,
      nextAttemptAt: null,
    });
    expect(state.attempts[0].status).toBe(EmailAttemptStatus.UNCERTAIN);
    expect(state.notifications.get('notification-1')).toBe(EmailNotificationStatus.DELIVERY_UNCERTAIN);
  });

  it('keeps successful separate recipients intact when another recipient exhausts retries', async () => {
    const state = makeWorkerState([
      deliveryFixture({ id: 'delivery-sent', status: EmailDeliveryStatus.SENT }),
      deliveryFixture({
        id: 'delivery-failed',
        status: EmailDeliveryStatus.QUEUED,
        idempotencyKey: 'email-delivery:notification-1:2',
      }),
    ]);
    state.attempts.push({
      id: 'attempt-existing',
      deliveryId: 'delivery-failed',
      attemptNo: 1,
      status: EmailAttemptStatus.REJECTED,
    });
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    const send = jest.fn().mockRejectedValue(new EmailProviderFailure({
      kind: EmailProviderFailureKind.REJECTED,
      code: 'validation_error',
      message: 'Email provider rejected the request.',
    }));

    await dispatchQueuedEmailDeliveries({ workerId: 'worker-a', limit: 10, now, provider: provider(send) });

    expect(state.deliveries.find((row) => row.id === 'delivery-sent')?.status).toBe(EmailDeliveryStatus.SENT);
    expect(state.deliveries.find((row) => row.id === 'delivery-failed')?.status).toBe(EmailDeliveryStatus.FAILED);
    expect(state.notifications.get('notification-1')).toBe(EmailNotificationStatus.PARTIALLY_SENT);
  });
});
