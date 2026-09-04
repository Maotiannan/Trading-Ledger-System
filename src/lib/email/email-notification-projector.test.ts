import {
  EmailNotificationStatus,
  ReceiptStatus,
} from '@prisma/client';
import {
  cancelSourceNotificationsInTransaction,
  projectInvoiceEventsInTransaction,
  projectPaymentReceiptInTransaction,
  refreshCustomerNotificationEligibilityInTransaction,
  refreshInvoiceNotificationsInTransaction,
  refreshOrderLinkedNotificationsInTransaction,
  refreshReceiptNotificationInTransaction,
} from '@/lib/email/email-notification-projector';
import { logger } from '@/lib/logger';

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type NotificationRow = {
  id: string;
  eventKey: string;
  type: 'PAYMENT_RECEIVED' | 'SHIPMENT' | 'RELEASE';
  status: EmailNotificationStatus;
  customerId: string | null;
  receiptId: string | null;
  invoiceId: string | null;
  currentSnapshot: unknown;
  sourceActorId: string | null;
  correctionReason?: string | null;
};

function makeTransaction(input: {
  receipt?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
  notifications?: NotificationRow[];
  recipientCounts?: Record<string, number>;
  linkedReceiptIds?: string[];
  beforeNotificationCreate?: (notifications: NotificationRow[]) => void;
  beforeNotificationWrite?: (notifications: NotificationRow[]) => void;
}) {
  const notifications = [...(input.notifications || [])];
  let nextId = notifications.length + 1;
  const receiptFindUnique = jest.fn().mockResolvedValue(input.receipt ?? null);
  const receiptFindMany = jest.fn().mockResolvedValue(
    (input.linkedReceiptIds || []).map((id) => ({ id })),
  );
  const invoiceFindUnique = jest.fn().mockResolvedValue(input.invoice ?? null);
  const customerNotificationEmailCount = jest.fn(async ({ where }: { where: { customerId: string } }) => (
    input.recipientCounts?.[where.customerId] || 0
  ));
  const emailNotificationFindUnique = jest.fn(async ({ where }: { where: { id?: string; eventKey?: string } }) => (
    notifications.find((row) => (
      (where.id && row.id === where.id) || (where.eventKey && row.eventKey === where.eventKey)
    )) || null
  ));
  const emailNotificationFindMany = jest.fn(async ({ where }: { where?: Record<string, unknown> }) => (
    notifications.filter((row) => {
      if (!where) return true;
      if (where.receiptId && row.receiptId !== where.receiptId) return false;
      if (where.invoiceId && row.invoiceId !== where.invoiceId) return false;
      if (where.customerId && row.customerId !== where.customerId) return false;
      if (where.type && row.type !== where.type) return false;
      return true;
    })
  ));
  const emailNotificationCreate = jest.fn(async ({ data }: { data: Omit<NotificationRow, 'id'> }) => {
    input.beforeNotificationCreate?.(notifications);
    if (notifications.some((candidate) => candidate.eventKey === data.eventKey)) {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    }
    const created = { id: `notification-${nextId++}`, ...data } as NotificationRow;
    notifications.push(created);
    return created;
  });
  const emailNotificationUpdate = jest.fn(async ({ where, data }: {
    where: { id?: string; eventKey?: string };
    data: Partial<NotificationRow>;
  }) => {
    input.beforeNotificationWrite?.(notifications);
    const row = notifications.find((candidate) => (
      (where.id && candidate.id === where.id) || (where.eventKey && candidate.eventKey === where.eventKey)
    ));
    if (!row) throw new Error('Notification not found');
    Object.assign(row, data);
    return row;
  });
  const emailNotificationUpsert = jest.fn(async ({ where, create, update }: {
    where: { eventKey: string };
    create: Omit<NotificationRow, 'id'>;
    update: Partial<NotificationRow>;
  }) => {
    input.beforeNotificationCreate?.(notifications);
    const existing = notifications.find((candidate) => candidate.eventKey === where.eventKey);
    if (existing) {
      return emailNotificationUpdate({ where: { id: existing.id }, data: update });
    }
    return emailNotificationCreate({ data: create });
  });
  const emailNotificationUpdateMany = jest.fn(async ({ where, data }: {
    where: Record<string, unknown>;
    data: Partial<NotificationRow>;
  }) => {
    input.beforeNotificationWrite?.(notifications);
    let count = 0;
    for (const row of notifications) {
      if (where.id && row.id !== where.id) continue;
      if (where.customerId && row.customerId !== where.customerId) continue;
      if (where.receiptId && row.receiptId !== where.receiptId) continue;
      if (where.invoiceId && row.invoiceId !== where.invoiceId) continue;
      if (where.correctionReason && row.correctionReason !== where.correctionReason) continue;
      const statusFilter = where.status;
      if (typeof statusFilter === 'string' && row.status !== statusFilter) continue;
      if (statusFilter && typeof statusFilter === 'object') {
        const filter = statusFilter as { in?: string[]; notIn?: string[] };
        if (filter.in && !filter.in.includes(row.status)) continue;
        if (filter.notIn && filter.notIn.includes(row.status)) continue;
      }
      Object.assign(row, data);
      count += 1;
    }
    return { count };
  });

  return {
    tx: {
      receipt: { findUnique: receiptFindUnique, findMany: receiptFindMany },
      invoice: { findUnique: invoiceFindUnique },
      customerNotificationEmail: { count: customerNotificationEmailCount },
      emailNotification: {
        findUnique: emailNotificationFindUnique,
        findMany: emailNotificationFindMany,
        create: emailNotificationCreate,
        upsert: emailNotificationUpsert,
        update: emailNotificationUpdate,
        updateMany: emailNotificationUpdateMany,
      },
    },
    notifications,
    receiptFindUnique,
    receiptFindMany,
    invoiceFindUnique,
    customerNotificationEmailCount,
    emailNotificationCreate,
    emailNotificationUpsert,
    emailNotificationUpdate,
    emailNotificationUpdateMany,
  };
}

function customer(id: string, mark: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    companyName: `${mark} Trading`,
    name: `${mark} Customer`,
    mark,
    notificationLanguage: 'ENGLISH',
    notificationEmails: [{ id: `email-${id}` }],
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    receiptNo: '0010001',
    date: new Date('2026-08-31T00:00:00.000Z'),
    usd: 1250,
    invNo: 'INV-001',
    orderNo: 'AB-01',
    status: ReceiptStatus.SR_Received,
    customerId: 'customer-1',
    customer: customer('customer-1', 'AB'),
    generatedByBalanceTransfer: null,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    invNo: 'INV-001',
    shipDate: new Date('2026-08-20T00:00:00.000Z'),
    releaseDate: new Date('2026-08-30T00:00:00.000Z'),
    orders: [
      { id: 'order-1', orderNo: 'AB-01', customerId: 'customer-1', customer: customer('customer-1', 'AB') },
    ],
    ...overrides,
  };
}

describe('email-notification-projector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['normal direct receipt', receipt(), true, undefined],
    ['uploaded receipt', receipt({ imageUrl: '/upload/receipt.jpg' }), true, undefined],
    ['detail-generated receipt', receipt({ note: '由付款明细自动创建' }), true, undefined],
    ['unfinished signed receipt', receipt({ status: ReceiptStatus.SIGNING_PENDING }), false, 'SIGNING_PENDING'],
    ['TRANSFER receipt', receipt({ receiptNo: 'TRANSFER-123' }), false, 'BALANCE_TRANSFER'],
    ['Balance Transfer receipt', receipt({ generatedByBalanceTransfer: { id: 'transfer-1' } }), false, 'BALANCE_TRANSFER'],
  ])('%s projection eligibility is enforced', async (_name, source, projected, reason) => {
    const state = makeTransaction({
      receipt: source,
      recipientCounts: { 'customer-1': 1 },
    });

    await expect(projectPaymentReceiptInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'sales-1',
    })).resolves.toMatchObject({ projected, ...(reason ? { reason } : {}) });

    expect(state.emailNotificationCreate).toHaveBeenCalledTimes(projected ? 1 : 0);
  });

  it('projects a payment from persisted customerId and shared customer display data', async () => {
    const state = makeTransaction({
      receipt: receipt({
        orderNo: 'AB-01/AB-02',
        customer: customer('customer-1', 'AB', { companyName: 'Alpha Business', name: 'Ignored Name' }),
      }),
      recipientCounts: { 'customer-1': 1 },
    });

    const result = await projectPaymentReceiptInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'sales-1',
    });

    expect(result).toMatchObject({ projected: true, eventKey: 'PAYMENT_RECEIVED:receipt-1' });
    expect(state.emailNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: 'PAYMENT_RECEIVED:receipt-1',
        type: 'PAYMENT_RECEIVED',
        status: 'PENDING',
        customerId: 'customer-1',
        receiptId: 'receipt-1',
        sourceActorId: 'sales-1',
        currentSnapshot: expect.objectContaining({
          customerName: 'Alpha Business "AB"',
          mark: 'AB',
          orderNos: ['AB-01', 'AB-02'],
          receiptNo: '0010001',
          invoiceNo: 'INV-001',
          amount: 1250,
        }),
      }),
    });
  });

  it('does not guess a customer from MARK when customerId is missing', async () => {
    const state = makeTransaction({
      receipt: receipt({ customerId: null, customer: null, customerMark: 'AB' }),
    });

    await expect(projectPaymentReceiptInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'sales-1',
    })).resolves.toEqual({ projected: false, reason: 'MISSING_CUSTOMER' });

    expect(state.emailNotificationCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Email notification source has no persisted customer', expect.objectContaining({
      sourceType: 'RECEIPT',
      receiptId: 'receipt-1',
    }));
  });

  it('marks a task missing-recipient until the customer has an address', async () => {
    const state = makeTransaction({
      receipt: receipt({ customer: customer('customer-1', 'AB', { notificationEmails: [] }) }),
    });

    await projectPaymentReceiptInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'sales-1',
    });

    expect(state.emailNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'MISSING_RECIPIENT' }),
    });
  });

  it('refreshes an unsent receipt task and flags a sent task for correction', async () => {
    const source = receipt({ usd: 1600 });
    const pending = makeTransaction({
      receipt: source,
      recipientCounts: { 'customer-1': 1 },
      notifications: [{
        id: 'notification-1',
        eventKey: 'PAYMENT_RECEIVED:receipt-1',
        type: 'PAYMENT_RECEIVED',
        status: EmailNotificationStatus.PENDING,
        customerId: 'customer-1',
        receiptId: 'receipt-1',
        invoiceId: null,
        currentSnapshot: { amount: 1250 },
        sourceActorId: 'sales-1',
      }],
    });

    await refreshReceiptNotificationInTransaction(pending.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'admin-1',
    });
    expect(pending.notifications[0]).toMatchObject({
      status: 'PENDING',
      sourceActorId: 'admin-1',
      currentSnapshot: expect.objectContaining({ amount: 1600 }),
    });

    pending.notifications[0].status = EmailNotificationStatus.SENT;
    (source as { usd: number }).usd = 1700;
    await refreshReceiptNotificationInTransaction(pending.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'admin-2',
    });
    expect(pending.notifications[0]).toMatchObject({ status: 'NEEDS_CORRECTION' });
  });

  it('does not backfill a historical payment task during a refresh-only mutation', async () => {
    const state = makeTransaction({
      receipt: receipt(),
      recipientCounts: { 'customer-1': 1 },
    });

    await expect(refreshReceiptNotificationInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'admin-1',
    })).resolves.toEqual({ refreshed: false, reason: 'EVENT_NOT_PROJECTED' });

    expect(state.emailNotificationCreate).not.toHaveBeenCalled();
  });

  it('never regresses a concurrently sent notification to pending', async () => {
    let injected = false;
    const state = makeTransaction({
      receipt: receipt(),
      recipientCounts: { 'customer-1': 1 },
      beforeNotificationCreate: (notifications) => {
        if (injected) return;
        injected = true;
        notifications.push({
          id: 'notification-concurrent',
          eventKey: 'PAYMENT_RECEIVED:receipt-1',
          type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.SENT,
          customerId: 'customer-1',
          receiptId: 'receipt-1',
          invoiceId: null,
          currentSnapshot: {
            customerId: 'customer-1',
            customerName: 'AB Trading "AB"',
            mark: 'AB',
            language: 'ENGLISH',
            orderNos: ['AB-01'],
            invoiceNo: 'INV-001',
            receiptNo: '0010001',
            amount: 1250,
            paymentDate: '2026-08-31T00:00:00.000Z',
          },
          sourceActorId: 'sales-1',
        });
      },
    });

    await projectPaymentReceiptInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'sales-2',
    });

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].status).toBe(EmailNotificationStatus.SENT);
  });

  it('creates invoice tasks once and strictly groups order data by customer', async () => {
    const source = invoice({
      orders: [
        { id: 'order-1', orderNo: 'AB-01', customerId: 'customer-1', customer: customer('customer-1', 'AB') },
        { id: 'order-2', orderNo: 'AB-02', customerId: 'customer-1', customer: customer('customer-1', 'AB') },
        {
          id: 'order-3',
          orderNo: 'CD-01',
          customerId: 'customer-2',
          customer: customer('customer-2', 'CD', { notificationEmails: [] }),
        },
      ],
    });
    const state = makeTransaction({
      invoice: source,
      recipientCounts: { 'customer-1': 1, 'customer-2': 0 },
    });

    const first = await projectInvoiceEventsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      beforeShipDate: null,
      beforeReleaseDate: null,
      actorId: 'sales-1',
    });
    const repeated = await projectInvoiceEventsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      beforeShipDate: source.shipDate as Date,
      beforeReleaseDate: source.releaseDate as Date,
      actorId: 'sales-1',
    });

    expect(first).toMatchObject({ projected: 4 });
    expect(repeated).toMatchObject({ projected: 0, refreshed: 4 });
    expect(state.notifications).toHaveLength(4);
    expect(state.notifications.find((row) => row.eventKey === 'SHIPMENT:invoice-1:customer-1')).toMatchObject({
      status: 'PENDING',
      currentSnapshot: expect.objectContaining({ orderNos: ['AB-01', 'AB-02'] }),
    });
    expect(state.notifications.find((row) => row.eventKey === 'RELEASE:invoice-1:customer-2')).toMatchObject({
      status: 'MISSING_RECIPIENT',
      currentSnapshot: expect.objectContaining({ orderNos: ['CD-01'] }),
    });
    expect(JSON.stringify(state.notifications.find((row) => row.customerId === 'customer-1'))).not.toContain('CD-01');
  });

  it('does not infer an invoice customer for an unbound order', async () => {
    const state = makeTransaction({
      invoice: invoice({
        releaseDate: null,
        orders: [{ id: 'order-unbound', orderNo: 'MARK-01', customerId: null, customer: null, customerMark: 'MARK' }],
      }),
    });

    await projectInvoiceEventsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      beforeShipDate: null,
      beforeReleaseDate: null,
      actorId: 'sales-1',
    });

    expect(state.emailNotificationCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Invoice order excluded from customer email projection', {
      invoiceId: 'invoice-1',
      orderId: 'order-unbound',
      orderNo: 'MARK-01',
      reason: 'MISSING_CUSTOMER_ID',
    });
  });

  it('cancels a cleared date and reuses the same event key when repopulated', async () => {
    const source = invoice({ shipDate: null, releaseDate: null });
    const state = makeTransaction({
      invoice: source,
      recipientCounts: { 'customer-1': 1 },
      notifications: [{
        id: 'notification-1',
        eventKey: 'SHIPMENT:invoice-1:customer-1',
        type: 'SHIPMENT',
        status: EmailNotificationStatus.PENDING,
        customerId: 'customer-1',
        receiptId: null,
        invoiceId: 'invoice-1',
        currentSnapshot: {},
        sourceActorId: 'sales-1',
      }],
    });

    await projectInvoiceEventsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      beforeShipDate: new Date('2026-08-20T00:00:00.000Z'),
      beforeReleaseDate: null,
      actorId: 'admin-1',
    });
    expect(state.notifications[0].status).toBe('CANCELLED');

    (source as { shipDate: Date | null }).shipDate = new Date('2026-09-01T00:00:00.000Z');
    await projectInvoiceEventsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      beforeShipDate: null,
      beforeReleaseDate: null,
      actorId: 'admin-1',
    });

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      eventKey: 'SHIPMENT:invoice-1:customer-1',
      status: 'PENDING',
    });
  });

  it('refreshes projected invoice membership and cancels stale customer tasks', async () => {
    const state = makeTransaction({
      invoice: invoice({
        releaseDate: null,
        orders: [{ id: 'order-2', orderNo: 'CD-02', customerId: 'customer-2', customer: customer('customer-2', 'CD') }],
      }),
      recipientCounts: { 'customer-2': 1 },
      notifications: [{
        id: 'notification-1',
        eventKey: 'SHIPMENT:invoice-1:customer-1',
        type: 'SHIPMENT',
        status: EmailNotificationStatus.PENDING,
        customerId: 'customer-1',
        receiptId: null,
        invoiceId: 'invoice-1',
        currentSnapshot: { orderNos: ['AB-01'] },
        sourceActorId: 'sales-1',
      }],
    });

    await refreshInvoiceNotificationsInTransaction(state.tx as never, {
      invoiceId: 'invoice-1',
      actorId: 'admin-1',
    });

    expect(state.notifications.find((row) => row.customerId === 'customer-1')?.status).toBe('CANCELLED');
    expect(state.notifications.find((row) => row.customerId === 'customer-2')).toMatchObject({
      eventKey: 'SHIPMENT:invoice-1:customer-2',
      status: 'PENDING',
      currentSnapshot: expect.objectContaining({ orderNos: ['CD-02'] }),
    });
  });

  it('cancels only definitely unsent source tasks and preserves in-flight or sent history for correction', async () => {
    const state = makeTransaction({
      notifications: [
        {
          id: 'notification-1',
          eventKey: 'PAYMENT_RECEIVED:receipt-1',
          type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.PENDING,
          customerId: 'customer-1',
          receiptId: 'receipt-1',
          invoiceId: null,
          currentSnapshot: {},
          sourceActorId: 'sales-1',
        },
        {
          id: 'notification-2',
          eventKey: 'PAYMENT_RECEIVED:receipt-2',
          type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.SENT,
          customerId: 'customer-1',
          receiptId: 'receipt-2',
          invoiceId: null,
          currentSnapshot: {},
          sourceActorId: 'sales-1',
        },
        {
          id: 'notification-3',
          eventKey: 'PAYMENT_RECEIVED:receipt-3',
          type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.SENDING,
          customerId: 'customer-1',
          receiptId: 'receipt-3',
          invoiceId: null,
          currentSnapshot: {},
          sourceActorId: 'sales-1',
        },
      ],
    });

    await cancelSourceNotificationsInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'admin-1',
      reason: 'SOURCE_DELETED',
    });
    await cancelSourceNotificationsInTransaction(state.tx as never, {
      receiptId: 'receipt-2',
      actorId: 'admin-1',
      reason: 'SOURCE_DELETED',
    });
    await cancelSourceNotificationsInTransaction(state.tx as never, {
      receiptId: 'receipt-3',
      actorId: 'admin-1',
      reason: 'SOURCE_DELETED',
    });

    expect(state.notifications[0]).toMatchObject({ status: 'CANCELLED' });
    expect(state.notifications[1]).toMatchObject({ status: 'NEEDS_CORRECTION' });
    expect(state.notifications[2]).toMatchObject({ status: 'NEEDS_CORRECTION' });
  });

  it('rechecks a queued task that becomes sending while its source is being removed', async () => {
    let raced = false;
    const state = makeTransaction({
      notifications: [{
        id: 'notification-1',
        eventKey: 'PAYMENT_RECEIVED:receipt-1',
        type: 'PAYMENT_RECEIVED',
        status: EmailNotificationStatus.QUEUED,
        customerId: 'customer-1',
        receiptId: 'receipt-1',
        invoiceId: null,
        currentSnapshot: {},
        sourceActorId: 'sales-1',
      }],
      beforeNotificationWrite: (notifications) => {
        if (raced) return;
        raced = true;
        notifications[0].status = EmailNotificationStatus.SENDING;
      },
    });

    await cancelSourceNotificationsInTransaction(state.tx as never, {
      receiptId: 'receipt-1',
      actorId: 'admin-1',
      reason: 'SOURCE_DELETED',
    });

    expect(state.notifications[0]).toMatchObject({
      status: EmailNotificationStatus.NEEDS_CORRECTION,
      correctionReason: 'SOURCE_DELETED',
    });
  });

  it('moves only eligible customer tasks between missing recipient and pending', async () => {
    const state = makeTransaction({
      recipientCounts: { 'customer-1': 1 },
      notifications: [
        {
          id: 'notification-1', eventKey: 'PAYMENT_RECEIVED:receipt-1', type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.MISSING_RECIPIENT, customerId: 'customer-1', receiptId: 'receipt-1',
          invoiceId: null, currentSnapshot: {}, sourceActorId: 'sales-1',
        },
        {
          id: 'notification-2', eventKey: 'PAYMENT_RECEIVED:receipt-2', type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.CANCELLED, customerId: 'customer-1', receiptId: 'receipt-2',
          invoiceId: null, currentSnapshot: {}, sourceActorId: 'sales-1',
        },
      ],
    });

    await refreshCustomerNotificationEligibilityInTransaction(state.tx as never, 'customer-1');

    expect(state.notifications[0].status).toBe('PENDING');
    expect(state.notifications[1].status).toBe('CANCELLED');
  });

  it('refreshes receipt and invoice tasks through one order-mutation interface', async () => {
    const sourceReceipt = receipt({ id: 'receipt-2' });
    const state = makeTransaction({
      receipt: sourceReceipt,
      invoice: invoice(),
      linkedReceiptIds: ['receipt-2'],
      recipientCounts: { 'customer-1': 1 },
      notifications: [
        {
          id: 'notification-1',
          eventKey: 'SHIPMENT:invoice-1:customer-1',
          type: 'SHIPMENT',
          status: EmailNotificationStatus.PENDING,
          customerId: 'customer-1',
          receiptId: null,
          invoiceId: 'invoice-1',
          currentSnapshot: {},
          sourceActorId: 'sales-1',
        },
        {
          id: 'notification-2',
          eventKey: 'PAYMENT_RECEIVED:receipt-2',
          type: 'PAYMENT_RECEIVED',
          status: EmailNotificationStatus.PENDING,
          customerId: 'customer-1',
          receiptId: 'receipt-2',
          invoiceId: null,
          currentSnapshot: {},
          sourceActorId: 'sales-1',
        },
      ],
    });

    await refreshOrderLinkedNotificationsInTransaction(state.tx as never, {
      orderIds: ['order-1'],
      invoiceIds: ['invoice-1'],
      actorId: 'admin-1',
    });

    expect(state.receiptFindMany).toHaveBeenCalledWith({
      where: { orderId: { in: ['order-1'] } },
      select: { id: true },
    });
    expect(state.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'PAYMENT_RECEIVED:receipt-2' }),
      expect.objectContaining({ eventKey: 'SHIPMENT:invoice-1:customer-1' }),
    ]));
  });

  it('refreshes an explicitly changed receipt even before it is linked to an order', async () => {
    const state = makeTransaction({
      receipt: receipt({ id: 'receipt-unlinked', orderId: null }),
      recipientCounts: { 'customer-1': 1 },
      notifications: [{
        id: 'notification-1',
        eventKey: 'PAYMENT_RECEIVED:receipt-unlinked',
        type: 'PAYMENT_RECEIVED',
        status: EmailNotificationStatus.PENDING,
        customerId: 'customer-1',
        receiptId: 'receipt-unlinked',
        invoiceId: null,
        currentSnapshot: { amount: 1000 },
        sourceActorId: 'sales-1',
      }],
    });

    await refreshOrderLinkedNotificationsInTransaction(state.tx as never, {
      orderIds: [],
      invoiceIds: [],
      receiptIds: ['receipt-unlinked'],
      actorId: 'admin-1',
    } as never);

    expect(state.receiptFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'receipt-unlinked' },
    }));
  });
});
