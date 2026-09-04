import {
  CustomerEmailLanguage,
  EmailDeliveryStatus,
  EmailNotificationStatus,
  EmailNotificationType,
  EmailRecipientMode,
  UserRole,
} from '@prisma/client';
import { db } from '@/lib/db';
import { getEmailSettings } from '@/lib/email/email-settings';
import { renderEmailTemplate } from '@/lib/email/email-template-renderer';
import {
  approveEmailNotifications,
  cancelEmailNotification,
  createCorrectionNotification,
  listEmailDeliveryAttempts,
  listEmailNotifications,
  previewEmailNotification,
  retryEmailNotification,
} from '@/lib/email/email-notification-service';
import { getHierarchyScope } from '@/lib/user-hierarchy';

jest.mock('@/lib/db', () => ({
  db: {
    emailNotification: {},
    emailDelivery: {},
    emailDeliveryAttempt: {},
    emailTemplate: {},
  },
}));

let mockTransactionClient: Record<string, unknown>;
jest.mock('@/lib/transaction', () => ({
  runInTransaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockTransactionClient)),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/email/email-settings', () => ({
  getEmailSettings: jest.fn(),
}));

jest.mock('@/lib/email/email-template-renderer', () => ({
  renderEmailTemplate: jest.fn(),
}));

jest.mock('@/lib/email/email-notification-projector', () => ({
  refreshInvoiceNotificationsInTransaction: jest.fn(),
  refreshReceiptNotificationInTransaction: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEventInTransaction: jest.fn(),
}));

type NotificationFixture = ReturnType<typeof notificationFixture>;
type DeliveryFixture = Record<string, unknown> & {
  id: string;
  notificationId: string;
  status: EmailDeliveryStatus;
};

function adminUser() {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: UserRole.ADMIN,
    level: 1,
    parentId: null,
    createdById: null,
  };
}

function notificationFixture(overrides: Record<string, unknown> = {}) {
  const customerId = String(overrides.customerId || 'customer-1');
  return {
    id: 'notification-1',
    eventKey: 'PAYMENT_RECEIVED:receipt-1',
    type: EmailNotificationType.PAYMENT_RECEIVED,
    status: EmailNotificationStatus.PENDING,
    customerId,
    receiptId: 'receipt-1',
    invoiceId: null,
    parentNotificationId: null,
    sourceActorId: 'sales-1',
    currentSnapshot: {
      customerId,
      customerName: 'Alpha Trading "AB"',
      mark: 'AB',
      language: 'ENGLISH',
      orderNos: ['AB-01'],
      invoiceNo: 'INV-001',
      receiptNo: '0010001',
      amount: 1250,
      paymentDate: '2026-09-01T00:00:00.000Z',
    },
    correctionReason: null,
    approvedBy: null,
    approvedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    customer: {
      id: customerId,
      ownerId: 'admin-1',
      name: 'Alpha Customer',
      companyName: 'Alpha Trading',
      mark: 'AB',
      notificationLanguage: CustomerEmailLanguage.ENGLISH,
      notificationEmails: [
        { id: 'email-primary', email: 'primary@example.com', isPrimary: true, createdAt: new Date('2026-01-01') },
        { id: 'email-copy', email: 'copy@example.com', isPrimary: false, createdAt: new Date('2026-01-02') },
      ],
    },
    receipt: { id: 'receipt-1', receiptNo: '0010001', orderNo: 'AB-01', invNo: 'INV-001' },
    invoice: null,
    deliveries: [],
    ...overrides,
  };
}

function templateFixture(language: CustomerEmailLanguage = CustomerEmailLanguage.ENGLISH) {
  return {
    id: `template-${language}`,
    type: EmailNotificationType.PAYMENT_RECEIVED,
    language,
    version: 2,
    subjectTemplate: 'Payment {{receiptNo}}',
    bodyTemplate: 'Payment {{amount}} for {{orderNos}}',
    requiredVariables: ['receiptNo', 'amount', 'orderNos'],
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

function makeState(initialNotifications: NotificationFixture[] = [notificationFixture()]) {
  const notifications = [...initialNotifications];
  const deliveries: DeliveryFixture[] = [];
  const attempts: Array<Record<string, unknown>> = [];
  const templates = [templateFixture(), templateFixture(CustomerEmailLanguage.FRENCH)];
  let deliverySequence = 1;
  let notificationSequence = 2;

  const notificationMatches = (row: NotificationFixture, where: Record<string, unknown> = {}) => {
    const id = where.id as string | { in?: string[] } | undefined;
    if (typeof id === 'string' && row.id !== id) return false;
    if (id && typeof id === 'object' && id.in && !id.in.includes(row.id)) return false;
    if (where.status) {
      const status = where.status as string | { in?: string[] };
      if (typeof status === 'string' && row.status !== status) return false;
      if (typeof status === 'object' && status.in && !status.in.includes(row.status)) return false;
    }
    if (where.parentNotificationId && row.parentNotificationId !== where.parentNotificationId) return false;
    const customer = where.customer as { ownerId?: { in?: string[] } } | undefined;
    if (customer?.ownerId?.in && !customer.ownerId.in.includes(row.customer.ownerId)) return false;
    return true;
  };

  const emailNotification = {
    count: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (
      notifications.filter((row) => notificationMatches(row, where)).length
    )),
    findMany: jest.fn(async ({ where, skip = 0, take }: {
      where?: Record<string, unknown>;
      skip?: number;
      take?: number;
    } = {}) => {
      const rows = notifications.filter((row) => notificationMatches(row, where));
      return rows.slice(skip, take ? skip + take : undefined);
    }),
    findFirst: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (
      notifications.find((row) => notificationMatches(row, where)) || null
    )),
    findUnique: jest.fn(async ({ where }: { where: { id?: string; eventKey?: string } }) => (
      notifications.find((row) => row.id === where.id || row.eventKey === where.eventKey) || null
    )),
    updateMany: jest.fn(async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const rows = notifications.filter((row) => notificationMatches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
    update: jest.fn(async ({ where, data }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = notifications.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error('notification missing');
      Object.assign(row, data);
      return row;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = notificationFixture({ id: `notification-${notificationSequence++}`, ...data });
      notifications.push(row);
      return row;
    }),
  };

  const deliveryMatches = (row: DeliveryFixture, where: Record<string, unknown> = {}) => {
    if (where.notificationId && row.notificationId !== where.notificationId) return false;
    const id = where.id as string | { in?: string[] } | undefined;
    if (typeof id === 'string' && row.id !== id) return false;
    if (id && typeof id === 'object' && id.in && !id.in.includes(row.id)) return false;
    if (where.status) {
      const status = where.status as string | { in?: string[] };
      if (typeof status === 'string' && row.status !== status) return false;
      if (typeof status === 'object' && status.in && !status.in.includes(row.status)) return false;
    }
    return true;
  };
  const emailDelivery = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `delivery-${deliverySequence++}`, ...data } as DeliveryFixture;
      deliveries.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (
      deliveries.filter((row) => deliveryMatches(row, where))
    )),
    updateMany: jest.fn(async ({ where, data }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const rows = deliveries.filter((row) => deliveryMatches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  };

  const client = {
    emailNotification,
    emailDelivery,
    emailDeliveryAttempt: {
      findMany: jest.fn(async () => attempts),
    },
    emailTemplate: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => (
        templates.find((row) => row.type === where.type && row.language === where.language && row.isActive) || null
      )),
      findMany: jest.fn(async () => templates),
    },
    customerNotificationEmail: { count: jest.fn() },
    receipt: { findUnique: jest.fn() },
    invoice: { findUnique: jest.fn() },
    systemSetting: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };

  return { client, notifications, deliveries, attempts };
}

const mockDb = db as unknown as Record<string, unknown>;
const mockGetEmailSettings = getEmailSettings as jest.Mock;
const mockRenderEmailTemplate = renderEmailTemplate as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;

describe('email-notification-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 'resend-test-key';
    const state = makeState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);
    mockGetHierarchyScope.mockResolvedValue({ ownerVisibleIds: new Set(['admin-1']) });
    mockGetEmailSettings.mockResolvedValue({
      outboundEnabled: true,
      recipientMode: EmailRecipientMode.PRIMARY_CC,
      senderName: 'MU LEDGER',
      senderAddress: 'ledger@example.com',
      replyToAddress: '',
      retryLimit: 3,
      retryIntervalsSeconds: [60, 300, 1800],
      testModeEnabled: false,
      testDestination: '',
      logoUrl: 'https://muledger.dainty.vip/logo.svg',
    });
    mockRenderEmailTemplate.mockImplementation((template: { language: string }) => ({
      subject: `${template.language} subject`,
      html: `<p>${template.language} body</p>`,
      text: `${template.language} body`,
      variables: [],
      templateVersion: 2,
    }));
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it('lists only notifications in the admin hierarchy scope with server pagination', async () => {
    const state = makeState([
      notificationFixture(),
      notificationFixture({
        id: 'notification-hidden',
        customerId: 'customer-hidden',
        customer: {
          ...notificationFixture().customer,
          id: 'customer-hidden',
          ownerId: 'other-admin',
        },
      }),
    ]);
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    const result = await listEmailNotifications(adminUser(), { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('notification-1');
  });

  it('previews a temporary language without mutating the customer preference', async () => {
    const result = await previewEmailNotification(adminUser(), {
      notificationId: 'notification-1',
      language: CustomerEmailLanguage.FRENCH,
    });

    expect(result.preview.subject).toBe('FRENCH subject');
    expect(mockRenderEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ language: CustomerEmailLanguage.FRENCH }),
      expect.objectContaining({ receiptNo: '0010001' }),
      expect.any(Object),
    );
    expect((mockTransactionClient as { emailNotification: { update: jest.Mock } }).emailNotification.update).not.toHaveBeenCalled();
  });

  it('blocks approval while outbound email is disabled', async () => {
    mockGetEmailSettings.mockResolvedValueOnce({
      ...(await mockGetEmailSettings()),
      outboundEnabled: false,
    });

    await expect(approveEmailNotifications(adminUser(), {
      notificationIds: ['notification-1'],
    })).rejects.toMatchObject({ code: 'EMAIL_OUTBOUND_DISABLED' });
  });

  it('blocks approval when the customer has no recipient', async () => {
    const state = makeState([notificationFixture({
      status: EmailNotificationStatus.MISSING_RECIPIENT,
      customer: { ...notificationFixture().customer, notificationEmails: [] },
    })]);
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(approveEmailNotifications(adminUser(), {
      notificationIds: ['notification-1'],
    })).rejects.toMatchObject({ code: 'EMAIL_MISSING_RECIPIENT' });
    expect(state.deliveries).toHaveLength(0);
  });

  it('freezes one primary plus CC delivery and prevents double approval', async () => {
    const state = makeState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    const result = await approveEmailNotifications(adminUser(), {
      notificationIds: ['notification-1'],
    });

    expect(result.queuedCount).toBe(1);
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]).toMatchObject({
      intendedTo: ['primary@example.com'],
      intendedCc: ['copy@example.com'],
      actualTo: ['primary@example.com'],
      actualCc: ['copy@example.com'],
      subject: 'ENGLISH subject',
      status: EmailDeliveryStatus.QUEUED,
    });
    expect(state.notifications[0].status).toBe(EmailNotificationStatus.QUEUED);

    await expect(approveEmailNotifications(adminUser(), {
      notificationIds: ['notification-1'],
    })).rejects.toMatchObject({ code: 'EMAIL_ALREADY_APPROVED' });
    expect(state.deliveries).toHaveLength(1);
  });

  it('creates separate immutable deliveries while test mode redirects actual recipients', async () => {
    mockGetEmailSettings.mockResolvedValueOnce({
      ...(await mockGetEmailSettings()),
      recipientMode: EmailRecipientMode.SEPARATE,
      testModeEnabled: true,
      testDestination: 'admin-test@example.com',
    });
    const state = makeState();
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await approveEmailNotifications(adminUser(), { notificationIds: ['notification-1'] });

    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries.map((row) => row.intendedTo)).toEqual([
      ['primary@example.com'],
      ['copy@example.com'],
    ]);
    expect(state.deliveries.every((row) => (
      JSON.stringify(row.actualTo) === JSON.stringify(['admin-test@example.com'])
    ))).toBe(true);
  });

  it('rejects a mixed-status batch before creating any delivery', async () => {
    const state = makeState([
      notificationFixture(),
      notificationFixture({ id: 'notification-sent', status: EmailNotificationStatus.SENT }),
    ]);
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(approveEmailNotifications(adminUser(), {
      notificationIds: ['notification-1', 'notification-sent'],
    })).rejects.toMatchObject({ code: 'EMAIL_ALREADY_APPROVED' });
    expect(state.deliveries).toHaveLength(0);
    expect(state.notifications[0].status).toBe(EmailNotificationStatus.PENDING);
  });

  it('cancels a queued notification before a worker claims it', async () => {
    const state = makeState([notificationFixture({ status: EmailNotificationStatus.QUEUED })]);
    state.deliveries.push({
      id: 'delivery-queued',
      notificationId: 'notification-1',
      status: EmailDeliveryStatus.QUEUED,
    });
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await cancelEmailNotification(adminUser(), { notificationId: 'notification-1' });

    expect(state.notifications[0].status).toBe(EmailNotificationStatus.CANCELLED);
    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.CANCELLED);
  });

  it('rejects cancellation when a worker claims the delivery concurrently', async () => {
    const state = makeState([notificationFixture({ status: EmailNotificationStatus.QUEUED })]);
    state.deliveries.push({
      id: 'delivery-queued',
      notificationId: 'notification-1',
      status: EmailDeliveryStatus.QUEUED,
    });
    state.client.emailDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(cancelEmailNotification(adminUser(), {
      notificationId: 'notification-1',
    })).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(state.notifications[0].status).toBe(EmailNotificationStatus.QUEUED);
  });

  it('retries only failed separate deliveries and preserves successful deliveries', async () => {
    const state = makeState([notificationFixture({ status: EmailNotificationStatus.PARTIALLY_SENT })]);
    state.deliveries.push(
      { id: 'delivery-sent', notificationId: 'notification-1', status: EmailDeliveryStatus.SENT },
      { id: 'delivery-failed', notificationId: 'notification-1', status: EmailDeliveryStatus.FAILED },
    );
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await retryEmailNotification(adminUser(), { notificationId: 'notification-1' });

    expect(state.deliveries.find((row) => row.id === 'delivery-sent')?.status).toBe(EmailDeliveryStatus.SENT);
    expect(state.deliveries.find((row) => row.id === 'delivery-failed')?.status).toBe(EmailDeliveryStatus.QUEUED);
    expect(state.notifications[0].status).toBe(EmailNotificationStatus.QUEUED);
  });

  it('requires explicit confirmation before retrying an uncertain delivery', async () => {
    const state = makeState([notificationFixture({ status: EmailNotificationStatus.DELIVERY_UNCERTAIN })]);
    state.deliveries.push({
      id: 'delivery-uncertain',
      notificationId: 'notification-1',
      status: EmailDeliveryStatus.DELIVERY_UNCERTAIN,
    });
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    await expect(retryEmailNotification(adminUser(), {
      notificationId: 'notification-1',
    })).rejects.toMatchObject({ code: 'EMAIL_UNSAFE_RETRY' });

    await retryEmailNotification(adminUser(), {
      notificationId: 'notification-1',
      confirmUncertain: true,
    });
    expect(state.deliveries[0].status).toBe(EmailDeliveryStatus.QUEUED);
  });

  it('creates a linked correction task without rewriting the original snapshot', async () => {
    const originalSnapshot = { ...notificationFixture().currentSnapshot, amount: 1500 };
    const state = makeState([notificationFixture({
      status: EmailNotificationStatus.NEEDS_CORRECTION,
      currentSnapshot: originalSnapshot,
      correctionReason: 'SOURCE_CHANGED',
    })]);
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    const result = await createCorrectionNotification(adminUser(), {
      notificationId: 'notification-1',
    });

    expect(result.notification).toMatchObject({
      parentNotificationId: 'notification-1',
      status: EmailNotificationStatus.PENDING,
      currentSnapshot: originalSnapshot,
    });
    expect(state.notifications[0].currentSnapshot).toEqual(originalSnapshot);
  });

  it('returns delivery attempts only for a visible notification', async () => {
    const state = makeState();
    state.deliveries.push({
      id: 'delivery-1',
      notificationId: 'notification-1',
      status: EmailDeliveryStatus.FAILED,
    });
    state.attempts.push({
      id: 'attempt-1',
      deliveryId: 'delivery-1',
      status: 'REJECTED',
      startedAt: new Date('2026-09-01T00:00:00.000Z'),
      finishedAt: new Date('2026-09-01T00:00:01.000Z'),
    });
    mockTransactionClient = state.client;
    Object.assign(mockDb, state.client);

    const result = await listEmailDeliveryAttempts(adminUser(), { notificationId: 'notification-1' });

    expect(result.data).toEqual([expect.objectContaining({ id: 'attempt-1' })]);
  });
});
