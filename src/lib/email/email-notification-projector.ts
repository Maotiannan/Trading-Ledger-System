import {
  EmailNotificationStatus,
  EmailNotificationType,
  Prisma,
  ReceiptStatus,
} from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { formatCustomerPayerLabel } from '@/lib/customer-display';
import { logger } from '@/lib/logger';
import type { DbTransactionClient } from '@/lib/transaction';

type ProjectionClient = Pick<
  DbTransactionClient,
  'receipt' | 'invoice' | 'emailNotification' | 'customerNotificationEmail'
>;

type ProjectionAction = 'PROJECTED' | 'REFRESHED' | 'NEEDS_CORRECTION' | 'UNCHANGED';
type InvoiceEventType = Extract<EmailNotificationType, 'SHIPMENT' | 'RELEASE'>;

type CustomerProjection = {
  id: string;
  companyName: string | null;
  name: string;
  mark: string;
  notificationLanguage: string;
  notificationEmails: Array<{ id: string }>;
};

type NotificationSnapshot = {
  customerId: string;
  customerName: string;
  mark: string;
  language: string;
  orderNos: string[];
  invoiceNo: string | null;
  receiptNo?: string;
  amount?: number;
  paymentDate?: string;
  shipmentDate?: string;
  releaseDate?: string;
};

const EDITABLE_NOTIFICATION_STATUSES = new Set<EmailNotificationStatus>([
  EmailNotificationStatus.MISSING_RECIPIENT,
  EmailNotificationStatus.PENDING,
]);

const SENT_OR_POSSIBLY_SENT_STATUSES = new Set<EmailNotificationStatus>([
  EmailNotificationStatus.SENDING,
  EmailNotificationStatus.SENT,
  EmailNotificationStatus.DELIVERED,
  EmailNotificationStatus.DELIVERY_DELAYED,
  EmailNotificationStatus.BOUNCED,
  EmailNotificationStatus.COMPLAINED,
  EmailNotificationStatus.SUPPRESSED,
  EmailNotificationStatus.PARTIALLY_SENT,
  EmailNotificationStatus.DELIVERY_UNCERTAIN,
  EmailNotificationStatus.NEEDS_CORRECTION,
]);

function splitOrderNos(value: string | null | undefined): string[] {
  return Array.from(new Set(
    String(value || '')
      .split('/')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function dateToIso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function buildCustomerSnapshot(customer: CustomerProjection) {
  const customerName = formatCustomerPayerLabel({
    companyName: customer.companyName,
    name: customer.name,
    mark: customer.mark,
  });
  if (!customerName) {
    throw new Error(`Customer ${customer.id} has no displayable name`);
  }
  return {
    customerId: customer.id,
    customerName,
    mark: customer.mark,
    language: customer.notificationLanguage,
  };
}

function initialStatus(customer: CustomerProjection): EmailNotificationStatus {
  return customer.notificationEmails.length > 0
    ? EmailNotificationStatus.PENDING
    : EmailNotificationStatus.MISSING_RECIPIENT;
}

type ExistingNotification = {
  id: string;
  status: EmailNotificationStatus;
  correctionReason: string | null;
  customerId: string | null;
  receiptId: string | null;
  invoiceId: string | null;
  currentSnapshot: Prisma.JsonValue;
};

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function hasSameProjection(
  existing: ExistingNotification,
  input: {
    customer: CustomerProjection;
    receiptId?: string | null;
    invoiceId?: string | null;
    snapshot: NotificationSnapshot;
  },
): boolean {
  return existing.customerId === input.customer.id
    && existing.receiptId === (input.receiptId || null)
    && existing.invoiceId === (input.invoiceId || null)
    && isDeepStrictEqual(existing.currentSnapshot, input.snapshot);
}

async function upsertCurrentNotification(
  tx: ProjectionClient,
  input: {
    eventKey: string;
    type: EmailNotificationType;
    customer: CustomerProjection;
    receiptId?: string | null;
    invoiceId?: string | null;
    actorId: string;
    snapshot: NotificationSnapshot;
  },
): Promise<ProjectionAction> {
  const readyStatus = initialStatus(input.customer);
  const jsonSnapshot = input.snapshot as Prisma.InputJsonValue;

  const loadExisting = () => tx.emailNotification.findUnique({
    where: { eventKey: input.eventKey },
    select: {
      id: true,
      status: true,
      correctionReason: true,
      customerId: true,
      receiptId: true,
      invoiceId: true,
      currentSnapshot: true,
    },
  });

  let existing = await loadExisting();
  if (!existing) {
    try {
      await tx.emailNotification.create({
        data: {
        eventKey: input.eventKey,
        type: input.type,
        status: readyStatus,
        customerId: input.customer.id,
        receiptId: input.receiptId || null,
        invoiceId: input.invoiceId || null,
        sourceActorId: input.actorId,
        currentSnapshot: jsonSnapshot,
      },
      });
      return 'PROJECTED';
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      existing = await loadExisting();
      if (!existing) throw error;
    }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canReactivateClearedDate = existing.status === EmailNotificationStatus.CANCELLED
      && existing.correctionReason === 'SOURCE_DATE_CLEARED';
    if (EDITABLE_NOTIFICATION_STATUSES.has(existing.status) || canReactivateClearedDate) {
      const updated = await tx.emailNotification.updateMany({
        where: {
          id: existing.id,
          status: existing.status,
          ...(canReactivateClearedDate ? { correctionReason: 'SOURCE_DATE_CLEARED' } : {}),
        },
        data: {
        status: readyStatus,
        customerId: input.customer.id,
        receiptId: input.receiptId || null,
        invoiceId: input.invoiceId || null,
        sourceActorId: input.actorId,
        currentSnapshot: jsonSnapshot,
        correctionReason: null,
        cancelledBy: null,
        cancelledAt: null,
      },
      });
      if (updated.count === 1) return 'REFRESHED';
    } else if (existing.status === EmailNotificationStatus.CANCELLED) {
      return 'UNCHANGED';
    } else if (hasSameProjection(existing, input)) {
      return 'UNCHANGED';
    } else {
      const updated = await tx.emailNotification.updateMany({
        where: { id: existing.id, status: existing.status },
        data: {
          status: EmailNotificationStatus.NEEDS_CORRECTION,
          customerId: input.customer.id,
          receiptId: input.receiptId || null,
          invoiceId: input.invoiceId || null,
          sourceActorId: input.actorId,
          currentSnapshot: jsonSnapshot,
          correctionReason: 'SOURCE_CHANGED',
        },
      });
      if (updated.count === 1) return 'NEEDS_CORRECTION';
    }

    const current = await loadExisting();
    if (!current) {
      throw new Error(`Email notification ${input.eventKey} disappeared during projection`);
    }
    existing = current;
  }

  throw new Error(`Email notification ${input.eventKey} changed concurrently too many times`);
}

function summarizeActions(actions: ProjectionAction[]) {
  return {
    projected: actions.filter((action) => action === 'PROJECTED').length,
    refreshed: actions.filter((action) => action === 'REFRESHED').length,
    needsCorrection: actions.filter((action) => action === 'NEEDS_CORRECTION').length,
    unchanged: actions.filter((action) => action === 'UNCHANGED').length,
  };
}

export async function projectPaymentReceiptInTransaction(
  tx: ProjectionClient,
  input: { receiptId: string; actorId: string },
) {
  const receipt = await tx.receipt.findUnique({
    where: { id: input.receiptId },
    include: {
      customer: {
        select: {
          id: true,
          companyName: true,
          name: true,
          mark: true,
          notificationLanguage: true,
          notificationEmails: { select: { id: true } },
        },
      },
      generatedByBalanceTransfer: { select: { id: true } },
    },
  });
  if (!receipt) return { projected: false as const, reason: 'SOURCE_NOT_FOUND' as const };
  if (receipt.generatedByBalanceTransfer || String(receipt.receiptNo || '').startsWith('TRANSFER-')) {
    return { projected: false as const, reason: 'BALANCE_TRANSFER' as const };
  }
  if (receipt.status === ReceiptStatus.SIGNING_PENDING) {
    return { projected: false as const, reason: 'SIGNING_PENDING' as const };
  }
  if (!receipt.customerId || !receipt.customer || receipt.customer.id !== receipt.customerId) {
    logger.warn('Email notification source has no persisted customer', {
      sourceType: 'RECEIPT',
      receiptId: receipt.id,
      receiptNo: receipt.receiptNo,
      orderNo: receipt.orderNo,
    });
    return { projected: false as const, reason: 'MISSING_CUSTOMER' as const };
  }

  const paymentDate = dateToIso(receipt.date || receipt.createdAt);
  const action = await upsertCurrentNotification(tx, {
    eventKey: `PAYMENT_RECEIVED:${receipt.id}`,
    type: EmailNotificationType.PAYMENT_RECEIVED,
    customer: receipt.customer,
    receiptId: receipt.id,
    actorId: input.actorId,
    snapshot: {
      ...buildCustomerSnapshot(receipt.customer),
      orderNos: splitOrderNos(receipt.orderNo),
      invoiceNo: receipt.invNo || null,
      receiptNo: receipt.receiptNo || receipt.id,
      amount: Number(receipt.usd),
      ...(paymentDate ? { paymentDate } : {}),
    },
  });
  return {
    projected: action === 'PROJECTED',
    refreshed: action === 'REFRESHED',
    needsCorrection: action === 'NEEDS_CORRECTION',
    eventKey: `PAYMENT_RECEIVED:${receipt.id}`,
  };
}

export async function refreshReceiptNotificationInTransaction(
  tx: ProjectionClient,
  input: { receiptId: string; actorId: string },
) {
  const existing = await tx.emailNotification.findUnique({
    where: { eventKey: `PAYMENT_RECEIVED:${input.receiptId}` },
    select: { id: true },
  });
  if (!existing) {
    return { refreshed: false as const, reason: 'EVENT_NOT_PROJECTED' as const };
  }
  return projectPaymentReceiptInTransaction(tx, input);
}

type InvoiceProjection = {
  id: string;
  invNo: string;
  shipDate: Date | null;
  releaseDate: Date | null;
  orders: Array<{
    id: string;
    orderNo: string;
    customerId: string | null;
    customer: CustomerProjection | null;
  }>;
};

function groupInvoiceOrders(invoice: InvoiceProjection) {
  const groups = new Map<string, { customer: CustomerProjection; orderNos: string[] }>();
  for (const order of invoice.orders) {
    if (!order.customerId || !order.customer || order.customer.id !== order.customerId) {
      logger.warn('Invoice order excluded from customer email projection', {
        invoiceId: invoice.id,
        orderId: order.id,
        orderNo: order.orderNo,
        reason: 'MISSING_CUSTOMER_ID',
      });
      continue;
    }
    const group = groups.get(order.customerId) || { customer: order.customer, orderNos: [] };
    group.orderNos.push(...splitOrderNos(order.orderNo));
    group.orderNos = Array.from(new Set(group.orderNos)).sort((a, b) => a.localeCompare(b));
    groups.set(order.customerId, group);
  }
  return groups;
}

async function loadInvoiceProjection(
  tx: ProjectionClient,
  invoiceId: string,
): Promise<InvoiceProjection | null> {
  return tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      orders: {
        select: {
          id: true,
          orderNo: true,
          customerId: true,
          customer: {
            select: {
              id: true,
              companyName: true,
              name: true,
              mark: true,
              notificationLanguage: true,
              notificationEmails: { select: { id: true } },
            },
          },
        },
      },
    },
  });
}

async function markNotificationRowsForSourceRemoval(
  tx: ProjectionClient,
  rows: Array<{ id: string; status: EmailNotificationStatus }>,
  input: { actorId: string; reason: string },
): Promise<number> {
  for (const row of rows) {
    let currentStatus = row.status;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const possiblySent = SENT_OR_POSSIBLY_SENT_STATUSES.has(currentStatus);
      const updated = await tx.emailNotification.updateMany({
        where: { id: row.id, status: currentStatus },
        data: possiblySent
          ? {
              status: EmailNotificationStatus.NEEDS_CORRECTION,
              correctionReason: input.reason,
              sourceActorId: input.actorId,
            }
          : {
              status: EmailNotificationStatus.CANCELLED,
              correctionReason: input.reason,
              sourceActorId: input.actorId,
              cancelledBy: input.actorId,
              cancelledAt: new Date(),
            },
      });
      if (updated.count === 1) break;

      const current = await tx.emailNotification.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      if (!current) break;
      currentStatus = current.status;
      if (attempt === 3) {
        throw new Error(`Email notification ${row.id} changed concurrently too many times`);
      }
    }
  }
  return rows.length;
}

async function synchronizeInvoiceEvent(
  tx: ProjectionClient,
  input: {
    invoice: InvoiceProjection;
    type: InvoiceEventType;
    actorId: string;
    allowCreate: boolean;
  },
): Promise<ProjectionAction[]> {
  const existingRows = await tx.emailNotification.findMany({
    where: { invoiceId: input.invoice.id, type: input.type },
    select: { id: true, status: true, customerId: true, eventKey: true },
  });
  const groups = groupInvoiceOrders(input.invoice);
  const currentCustomerIds = new Set(groups.keys());
  const staleRows = existingRows.filter((row) => !row.customerId || !currentCustomerIds.has(row.customerId));
  await markNotificationRowsForSourceRemoval(tx, staleRows, {
    actorId: input.actorId,
    reason: 'SOURCE_CUSTOMER_MEMBERSHIP_CHANGED',
  });

  const actions: ProjectionAction[] = [];
  const sourceDate = input.type === EmailNotificationType.SHIPMENT
    ? input.invoice.shipDate
    : input.invoice.releaseDate;
  if (!sourceDate) return actions;

  for (const [customerId, group] of groups.entries()) {
    const eventKey = `${input.type}:${input.invoice.id}:${customerId}`;
    const exists = existingRows.some((row) => row.eventKey === eventKey);
    if (!input.allowCreate && !exists) continue;
    actions.push(await upsertCurrentNotification(tx, {
      eventKey,
      type: input.type,
      customer: group.customer,
      invoiceId: input.invoice.id,
      actorId: input.actorId,
      snapshot: {
        ...buildCustomerSnapshot(group.customer),
        orderNos: group.orderNos,
        invoiceNo: input.invoice.invNo,
        ...(input.type === EmailNotificationType.SHIPMENT
          ? { shipmentDate: sourceDate.toISOString() }
          : { releaseDate: sourceDate.toISOString() }),
      },
    }));
  }
  return actions;
}

async function cancelInvoiceEventType(
  tx: ProjectionClient,
  input: {
    invoiceId: string;
    type: InvoiceEventType;
    actorId: string;
    reason: string;
  },
): Promise<number> {
  const rows = await tx.emailNotification.findMany({
    where: { invoiceId: input.invoiceId, type: input.type },
    select: { id: true, status: true },
  });
  return markNotificationRowsForSourceRemoval(tx, rows, input);
}

export async function projectInvoiceEventsInTransaction(
  tx: ProjectionClient,
  input: {
    invoiceId: string;
    beforeShipDate: Date | null | undefined;
    beforeReleaseDate: Date | null | undefined;
    actorId: string;
  },
) {
  const invoice = await loadInvoiceProjection(tx, input.invoiceId);
  if (!invoice) return { projected: 0, refreshed: 0, needsCorrection: 0, unchanged: 0, cancelled: 0 };

  const actions: ProjectionAction[] = [];
  let cancelled = 0;
  const events: Array<{
    type: InvoiceEventType;
    before: Date | null | undefined;
    current: Date | null;
  }> = [
    {
      type: EmailNotificationType.SHIPMENT,
      before: input.beforeShipDate,
      current: invoice.shipDate,
    },
    {
      type: EmailNotificationType.RELEASE,
      before: input.beforeReleaseDate,
      current: invoice.releaseDate,
    },
  ];
  for (const event of events) {
    if (!event.current) {
      if (event.before) {
        cancelled += await cancelInvoiceEventType(tx, {
          invoiceId: invoice.id,
          type: event.type,
          actorId: input.actorId,
          reason: 'SOURCE_DATE_CLEARED',
        });
      }
      continue;
    }
    const existingCount = await tx.emailNotification.findMany({
      where: { invoiceId: invoice.id, type: event.type },
      select: { id: true },
    });
    const allowCreate = !event.before || existingCount.length > 0;
    actions.push(...await synchronizeInvoiceEvent(tx, {
      invoice,
      type: event.type,
      actorId: input.actorId,
      allowCreate,
    }));
  }
  return { ...summarizeActions(actions), cancelled };
}

export async function refreshInvoiceNotificationsInTransaction(
  tx: ProjectionClient,
  input: { invoiceId: string; actorId: string },
) {
  const invoice = await loadInvoiceProjection(tx, input.invoiceId);
  if (!invoice) return { projected: 0, refreshed: 0, needsCorrection: 0, unchanged: 0, cancelled: 0 };

  const actions: ProjectionAction[] = [];
  let cancelled = 0;
  for (const type of [EmailNotificationType.SHIPMENT, EmailNotificationType.RELEASE] as const) {
    const existingRows = await tx.emailNotification.findMany({
      where: { invoiceId: invoice.id, type },
      select: { id: true },
    });
    if (existingRows.length === 0) continue;
    const currentDate = type === EmailNotificationType.SHIPMENT ? invoice.shipDate : invoice.releaseDate;
    if (!currentDate) {
      cancelled += await cancelInvoiceEventType(tx, {
        invoiceId: invoice.id,
        type,
        actorId: input.actorId,
        reason: 'SOURCE_DATE_CLEARED',
      });
      continue;
    }
    actions.push(...await synchronizeInvoiceEvent(tx, {
      invoice,
      type,
      actorId: input.actorId,
      allowCreate: true,
    }));
  }
  return { ...summarizeActions(actions), cancelled };
}

export async function cancelSourceNotificationsInTransaction(
  tx: ProjectionClient,
  input: {
    receiptId?: string;
    invoiceId?: string;
    actorId: string;
    reason: string;
  },
) {
  if (!input.receiptId && !input.invoiceId) return { cancelled: 0 };
  const rows = await tx.emailNotification.findMany({
    where: {
      ...(input.receiptId ? { receiptId: input.receiptId } : {}),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    },
    select: { id: true, status: true },
  });
  return {
    cancelled: await markNotificationRowsForSourceRemoval(tx, rows, input),
  };
}

export async function refreshCustomerNotificationEligibilityInTransaction(
  tx: Pick<ProjectionClient, 'customerNotificationEmail' | 'emailNotification'>,
  customerId: string,
): Promise<void> {
  const hasRecipients = await tx.customerNotificationEmail.count({ where: { customerId } }) > 0;
  await tx.emailNotification.updateMany({
    where: {
      customerId,
      status: hasRecipients
        ? EmailNotificationStatus.MISSING_RECIPIENT
        : EmailNotificationStatus.PENDING,
    },
    data: {
      status: hasRecipients
        ? EmailNotificationStatus.PENDING
        : EmailNotificationStatus.MISSING_RECIPIENT,
    },
  });
}

export async function refreshOrderLinkedNotificationsInTransaction(
  tx: ProjectionClient,
  input: {
    orderIds: string[];
    invoiceIds: string[];
    receiptIds?: string[];
    actorId: string;
  },
): Promise<void> {
  const orderIds = Array.from(new Set(input.orderIds.filter(Boolean)));
  const invoiceIds = Array.from(new Set(input.invoiceIds.filter(Boolean)));
  const explicitReceiptIds = Array.from(new Set((input.receiptIds || []).filter(Boolean)));
  const receiptRows = orderIds.length > 0
    ? await tx.receipt.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
    : [];

  const receiptIds = Array.from(new Set([
    ...explicitReceiptIds,
    ...receiptRows.map((receipt) => receipt.id),
  ]));
  for (const receiptId of receiptIds) {
    await refreshReceiptNotificationInTransaction(tx, {
      receiptId,
      actorId: input.actorId,
    });
  }
  for (const invoiceId of invoiceIds) {
    await refreshInvoiceNotificationsInTransaction(tx, {
      invoiceId,
      actorId: input.actorId,
    });
  }
}
