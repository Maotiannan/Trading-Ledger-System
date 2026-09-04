import {
  CustomerEmailLanguage,
  EmailDeliveryStatus,
  EmailNotificationStatus,
  EmailRecipientMode,
  Prisma,
  UserRole,
} from '@prisma/client';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { formatAppDate } from '@/lib/app-time';
import { db } from '@/lib/db';
import {
  refreshInvoiceNotificationsInTransaction,
  refreshReceiptNotificationInTransaction,
} from '@/lib/email/email-notification-projector';
import { getEmailSettings } from '@/lib/email/email-settings';
import { renderEmailTemplate } from '@/lib/email/email-template-renderer';
import type {
  EmailRenderContext,
  EmailSettings,
} from '@/lib/email/email-types';
import type { CurrentUser } from '@/lib/request-auth';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';
import { getHierarchyScope } from '@/lib/user-hierarchy';

const notificationInclude = Prisma.validator<Prisma.EmailNotificationInclude>()({
  customer: {
    select: {
      id: true,
      ownerId: true,
      name: true,
      companyName: true,
      mark: true,
      notificationLanguage: true,
      notificationEmails: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, email: true, isPrimary: true, createdAt: true },
      },
    },
  },
  receipt: { select: { id: true, receiptNo: true, orderNo: true, invNo: true } },
  invoice: { select: { id: true, invNo: true } },
  deliveries: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      intendedTo: true,
      intendedCc: true,
      actualTo: true,
      actualCc: true,
      subject: true,
      language: true,
      templateVersion: true,
      providerMessageId: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  },
});

type NotificationRow = Prisma.EmailNotificationGetPayload<{ include: typeof notificationInclude }>;
type ManagementClient = Pick<
  DbTransactionClient,
  | 'emailNotification'
  | 'emailDelivery'
  | 'emailDeliveryAttempt'
  | 'emailTemplate'
  | 'systemSetting'
  | 'customerNotificationEmail'
  | 'receipt'
  | 'invoice'
  | 'auditLog'
  | '$queryRaw'
>;

const PREVIEWABLE_STATUSES = new Set<EmailNotificationStatus>([
  EmailNotificationStatus.MISSING_RECIPIENT,
  EmailNotificationStatus.PENDING,
]);
const CANCELLABLE_STATUSES = new Set<EmailNotificationStatus>([
  EmailNotificationStatus.MISSING_RECIPIENT,
  EmailNotificationStatus.PENDING,
  EmailNotificationStatus.QUEUED,
  EmailNotificationStatus.FAILED,
]);

function assertAdmin(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({
      code: apiErrorCodes.FORBIDDEN,
      status: 403,
      message: '只有管理员可以管理客户邮件',
    });
  }
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function notificationId(value: unknown): string {
  const id = text(value);
  if (!id) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '邮件任务ID不能为空',
    });
  }
  return id;
}

function notificationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '邮件任务列表格式无效',
    });
  }
  const ids = Array.from(new Set(value.map(text).filter(Boolean))).sort();
  if (ids.length === 0 || ids.length > 100) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '每次必须选择 1 至 100 个邮件任务',
    });
  }
  return ids;
}

function parseLanguage(value: unknown, fallback: CustomerEmailLanguage): CustomerEmailLanguage {
  const language = text(value).toUpperCase();
  if (!language) return fallback;
  if (language === CustomerEmailLanguage.ENGLISH || language === CustomerEmailLanguage.FRENCH) {
    return language;
  }
  throw createApiError({
    code: apiErrorCodes.VALIDATION_ERROR,
    status: 400,
    message: '邮件语言无效',
  });
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function dateBoundary(value: unknown, endOfDay: boolean): Date | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.getTime())) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '日期筛选格式无效',
    });
  }
  return date;
}

async function visibleOwnerIds(currentUser: CurrentUser): Promise<string[]> {
  assertAdmin(currentUser);
  const scope = await getHierarchyScope(currentUser);
  return Array.from(scope.ownerVisibleIds);
}

function visibilityWhere(ownerIds: string[]): Prisma.EmailNotificationWhereInput {
  return { customer: { ownerId: { in: ownerIds } } };
}

function jsonStrings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    eventKey: row.eventKey,
    type: row.type,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer?.companyName || row.customer?.name || null,
    mark: row.customer?.mark || null,
    language: row.customer?.notificationLanguage || null,
    primaryEmail: row.customer?.notificationEmails[0]?.email || null,
    additionalEmailCount: Math.max(0, (row.customer?.notificationEmails.length || 0) - 1),
    receiptId: row.receiptId,
    receiptNo: row.receipt?.receiptNo || null,
    invoiceId: row.invoiceId,
    invoiceNo: row.invoice?.invNo || null,
    currentSnapshot: row.currentSnapshot,
    correctionReason: row.correctionReason,
    parentNotificationId: row.parentNotificationId,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() || null,
    cancelledBy: row.cancelledBy,
    cancelledAt: row.cancelledAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deliveries: row.deliveries.map((delivery) => ({
      ...delivery,
      intendedTo: jsonStrings(delivery.intendedTo),
      intendedCc: jsonStrings(delivery.intendedCc),
      actualTo: jsonStrings(delivery.actualTo),
      actualCc: jsonStrings(delivery.actualCc),
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    })),
  };
}

function listWhere(input: Record<string, unknown>, ownerIds: string[]): Prisma.EmailNotificationWhereInput {
  const where: Prisma.EmailNotificationWhereInput = visibilityWhere(ownerIds);
  const query = text(input.search);
  if (query) {
    where.OR = [
      { eventKey: { contains: query } },
      { customer: { name: { contains: query } } },
      { customer: { companyName: { contains: query } } },
      { customer: { mark: { contains: query } } },
      { receipt: { receiptNo: { contains: query } } },
      { receipt: { orderNo: { contains: query } } },
      { receipt: { invNo: { contains: query } } },
      { invoice: { invNo: { contains: query } } },
      { invoice: { orders: { some: { orderNo: { contains: query } } } } },
    ];
  }
  const types = Array.isArray(input.types) ? input.types.map(text).filter(Boolean) : [];
  if (types.length > 0) where.type = { in: types as Prisma.EnumEmailNotificationTypeFilter['in'] };
  const statuses = Array.isArray(input.statuses) ? input.statuses.map(text).filter(Boolean) : [];
  if (statuses.length > 0) where.status = { in: statuses as Prisma.EnumEmailNotificationStatusFilter['in'] };
  const from = dateBoundary(input.dateFrom, false);
  const to = dateBoundary(input.dateTo, true);
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  return where;
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function listEmailNotifications(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const ownerIds = await visibleOwnerIds(currentUser);
  const page = pageNumber(raw.page, 1, 1_000_000);
  const pageSize = pageNumber(raw.pageSize, 20, 100);
  const where = listWhere(raw, ownerIds);
  const [total, rows] = await Promise.all([
    db.emailNotification.count({ where }),
    db.emailNotification.findMany({
      where,
      include: notificationInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    data: rows.map(serializeNotification),
    total,
    page,
    pageSize,
    message: `邮件任务已加载，共 ${total} 条`,
  };
}

async function lockNotificationRows(client: ManagementClient, ids: string[]): Promise<void> {
  await client.$queryRaw(Prisma.sql`
    SELECT id
    FROM EmailNotification
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE
  `);
}

async function refreshNotificationSource(
  client: ManagementClient,
  row: Pick<NotificationRow, 'id' | 'parentNotificationId' | 'receiptId' | 'invoiceId'>,
  actorId: string,
): Promise<void> {
  if (row.parentNotificationId) return;
  if (row.receiptId) {
    await refreshReceiptNotificationInTransaction(client, { receiptId: row.receiptId, actorId });
  } else if (row.invoiceId) {
    await refreshInvoiceNotificationsInTransaction(client, { invoiceId: row.invoiceId, actorId });
  }
}

function assertSourceAvailable(row: NotificationRow): void {
  if (!row.customer || (row.receiptId && !row.receipt) || (row.invoiceId && !row.invoice)) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_SOURCE_CHANGED,
      status: 409,
      message: '邮件对应的业务数据已删除或失效，请刷新后处理',
      detail: { notificationId: row.id },
    });
  }
}

async function findVisibleNotification(
  client: ManagementClient,
  ownerIds: string[],
  id: string,
): Promise<NotificationRow> {
  const row = await client.emailNotification.findFirst({
    where: { id, ...visibilityWhere(ownerIds) },
    include: notificationInclude,
  });
  if (!row) {
    throw createApiError({
      code: apiErrorCodes.RESOURCE_NOT_FOUND,
      status: 404,
      message: '邮件任务不存在或无权限',
      detail: { notificationId: id },
    });
  }
  return row;
}

function snapshotObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_SOURCE_CHANGED,
      status: 409,
      message: '邮件业务快照无效',
    });
  }
  return value as Record<string, unknown>;
}

function formatAmount(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderContext(snapshotValue: Prisma.JsonValue): EmailRenderContext {
  const snapshot = snapshotObject(snapshotValue);
  const orderNos = Array.isArray(snapshot.orderNos)
    ? snapshot.orderNos.map(String).filter(Boolean).join(' / ')
    : text(snapshot.orderNos);
  return {
    customerName: text(snapshot.customerName),
    mark: text(snapshot.mark),
    orderNos,
    invoiceNo: text(snapshot.invoiceNo),
    receiptNo: text(snapshot.receiptNo),
    amount: formatAmount(snapshot.amount),
    paymentDate: formatAppDate(text(snapshot.paymentDate), ''),
    shipmentDate: formatAppDate(text(snapshot.shipmentDate), ''),
    releaseDate: formatAppDate(text(snapshot.releaseDate), ''),
  };
}

async function renderNotification(
  client: ManagementClient,
  row: NotificationRow,
  language: CustomerEmailLanguage,
  settings: EmailSettings,
) {
  const template = await client.emailTemplate.findFirst({
    where: { type: row.type, language, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!template) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_TEMPLATE_INVALID,
      status: 409,
      message: '找不到当前语言对应的有效邮件模板',
      detail: { type: row.type, language },
    });
  }
  try {
    const rendered = renderEmailTemplate({
      id: template.id,
      type: template.type,
      language: template.language,
      version: template.version,
      subjectTemplate: template.subjectTemplate,
      bodyTemplate: template.bodyTemplate,
    }, renderContext(row.currentSnapshot), { logoUrl: settings.logoUrl });
    return { template, rendered };
  } catch (error) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_TEMPLATE_INVALID,
      status: 409,
      message: '邮件模板无法使用当前业务数据生成内容',
      detail: { type: row.type, language, reason: error instanceof Error ? error.message : 'UNKNOWN' },
    });
  }
}

function recipientPlans(row: NotificationRow, settings: EmailSettings) {
  const addresses = row.customer?.notificationEmails.map((item) => item.email) || [];
  if (addresses.length === 0) return [];
  const intended = settings.recipientMode === EmailRecipientMode.SEPARATE
    ? addresses.map((email) => ({ to: [email], cc: [] as string[] }))
    : [{ to: [addresses[0]], cc: addresses.slice(1) }];
  return intended.map((target) => ({
    intendedTo: target.to,
    intendedCc: target.cc,
    actualTo: settings.testModeEnabled ? [settings.testDestination] : target.to,
    actualCc: settings.testModeEnabled ? [] : target.cc,
  }));
}

export async function previewEmailNotification(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const id = notificationId(raw.notificationId);
  const ownerIds = await visibleOwnerIds(currentUser);
  return runInTransaction(async (tx) => {
    let row = await findVisibleNotification(tx, ownerIds, id);
    if (!PREVIEWABLE_STATUSES.has(row.status)) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_ALREADY_APPROVED,
        status: 409,
        message: '当前状态不能生成待发送预览',
        detail: { notificationId: id, status: row.status },
      });
    }
    await refreshNotificationSource(tx, row, currentUser.id);
    row = await findVisibleNotification(tx, ownerIds, id);
    assertSourceAvailable(row);
    const language = parseLanguage(raw.language, row.customer!.notificationLanguage);
    const settings = await getEmailSettings(tx);
    const { template, rendered } = await renderNotification(tx, row, language, settings);
    const plans = recipientPlans(row, settings);
    return {
      notification: serializeNotification(row),
      preview: rendered,
      templateId: template.id,
      language,
      intendedRecipients: plans.map((plan) => ({ to: plan.intendedTo, cc: plan.intendedCc })),
      actualRecipients: plans.map((plan) => ({ to: plan.actualTo, cc: plan.actualCc })),
      testModeRedirected: settings.testModeEnabled,
      missingRecipient: plans.length === 0,
      message: '邮件预览已生成',
    };
  });
}

function assertApprovalSettings(settings: EmailSettings): void {
  if (!settings.outboundEnabled) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_OUTBOUND_DISABLED,
      status: 409,
      message: '邮件外发功能尚未启用',
    });
  }
  if (!process.env.RESEND_API_KEY?.trim() || !settings.senderAddress || !settings.senderName) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_PROVIDER_CONFIG_MISSING,
      status: 409,
      message: '邮件服务或发件人尚未正确配置',
    });
  }
  if (settings.testModeEnabled && !settings.testDestination) {
    throw createApiError({
      code: apiErrorCodes.EMAIL_PROVIDER_CONFIG_MISSING,
      status: 409,
      message: '测试模式缺少测试收件邮箱',
    });
  }
}

type ApprovalPlan = {
  row: NotificationRow;
  language: CustomerEmailLanguage;
  template: Awaited<ReturnType<typeof renderNotification>>['template'];
  rendered: Awaited<ReturnType<typeof renderNotification>>['rendered'];
  recipients: ReturnType<typeof recipientPlans>;
};

export async function approveEmailNotifications(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const ids = notificationIds(raw.notificationIds);
  const ownerIds = await visibleOwnerIds(currentUser);
  return runInTransaction(async (tx) => {
    await lockNotificationRows(tx, ids);
    const settings = await getEmailSettings(tx);
    assertApprovalSettings(settings);
    let rows = await tx.emailNotification.findMany({
      where: { id: { in: ids }, ...visibilityWhere(ownerIds) },
      include: notificationInclude,
      orderBy: { id: 'asc' },
    });
    if (rows.length !== ids.length) {
      throw createApiError({
        code: apiErrorCodes.RESOURCE_NOT_FOUND,
        status: 404,
        message: '部分邮件任务不存在或无权限',
      });
    }
    const missing = rows.find((row) => (
      row.status === EmailNotificationStatus.MISSING_RECIPIENT
      || !row.customer?.notificationEmails.length
    ));
    if (missing) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_MISSING_RECIPIENT,
        status: 409,
        message: '客户尚未配置通知邮箱',
        detail: { notificationId: missing.id },
      });
    }
    const invalid = rows.find((row) => row.status !== EmailNotificationStatus.PENDING);
    if (invalid) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_ALREADY_APPROVED,
        status: 409,
        message: '邮件任务已审批或状态已变化',
        detail: { notificationId: invalid.id, status: invalid.status },
      });
    }
    for (const row of rows) await refreshNotificationSource(tx, row, currentUser.id);
    rows = await tx.emailNotification.findMany({
      where: { id: { in: ids }, ...visibilityWhere(ownerIds) },
      include: notificationInclude,
      orderBy: { id: 'asc' },
    });

    const plans: ApprovalPlan[] = [];
    for (const row of rows) {
      assertSourceAvailable(row);
      if (row.status !== EmailNotificationStatus.PENDING) {
        throw createApiError({
          code: row.status === EmailNotificationStatus.MISSING_RECIPIENT
            ? apiErrorCodes.EMAIL_MISSING_RECIPIENT
            : apiErrorCodes.EMAIL_SOURCE_CHANGED,
          status: 409,
          message: row.status === EmailNotificationStatus.MISSING_RECIPIENT
            ? '客户尚未配置通知邮箱'
            : '业务数据在审批过程中发生变化，请重新预览',
          detail: { notificationId: row.id, status: row.status },
        });
      }
      const language = row.customer!.notificationLanguage;
      const rendered = await renderNotification(tx, row, language, settings);
      const recipients = recipientPlans(row, settings);
      if (recipients.length === 0) {
        throw createApiError({
          code: apiErrorCodes.EMAIL_MISSING_RECIPIENT,
          status: 409,
          message: '客户尚未配置通知邮箱',
          detail: { notificationId: row.id },
        });
      }
      plans.push({ row, language, ...rendered, recipients });
    }

    const updated = await tx.emailNotification.updateMany({
      where: { id: { in: ids }, status: EmailNotificationStatus.PENDING },
      data: {
        status: EmailNotificationStatus.QUEUED,
        approvedBy: currentUser.id,
        approvedAt: new Date(),
      },
    });
    if (updated.count !== ids.length) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_ALREADY_APPROVED,
        status: 409,
        message: '邮件任务状态已变化，请刷新后重试',
      });
    }

    let deliveryCount = 0;
    for (const plan of plans) {
      for (const [index, recipients] of plan.recipients.entries()) {
        await tx.emailDelivery.create({
          data: {
            notificationId: plan.row.id,
            templateId: plan.template.id,
            status: EmailDeliveryStatus.QUEUED,
            recipientMode: settings.recipientMode,
            language: plan.language,
            templateVersion: plan.template.version,
            senderName: settings.senderName,
            senderAddress: settings.senderAddress,
            replyToAddress: settings.replyToAddress || null,
            intendedTo: recipients.intendedTo,
            intendedCc: recipients.intendedCc,
            actualTo: recipients.actualTo,
            actualCc: recipients.actualCc,
            subject: plan.rendered.subject,
            htmlBody: plan.rendered.html,
            textBody: plan.rendered.text,
            businessSnapshot: snapshotObject(plan.row.currentSnapshot) as Prisma.InputJsonValue,
            idempotencyKey: `email-delivery:${plan.row.id}:${index + 1}`,
            nextAttemptAt: new Date(),
          },
        });
        deliveryCount += 1;
      }
      await recordAuditEventInTransaction(tx, {
        action: auditActions.EMAIL_NOTIFICATION_APPROVE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.EMAIL_NOTIFICATION,
        targetId: plan.row.id,
        metadata: {
          deliveryCount: plan.recipients.length,
          recipientMode: settings.recipientMode,
          intendedDestinationCount: plan.recipients.reduce((sum, item) => (
            sum + item.intendedTo.length + item.intendedCc.length
          ), 0),
          actualDestinationCount: plan.recipients.reduce((sum, item) => (
            sum + item.actualTo.length + item.actualCc.length
          ), 0),
          testModeRedirected: settings.testModeEnabled,
        },
      });
      if (settings.testModeEnabled) {
        await recordAuditEventInTransaction(tx, {
          action: auditActions.EMAIL_NOTIFICATION_TEST_REDIRECT,
          actorId: currentUser.id,
          targetType: auditTargetTypes.EMAIL_NOTIFICATION,
          targetId: plan.row.id,
          metadata: {
            intendedDestinationCount: plan.recipients.reduce((sum, item) => (
              sum + item.intendedTo.length + item.intendedCc.length
            ), 0),
            actualDestinationCount: plan.recipients.length,
          },
        });
      }
    }
    if (plans.length > 1) {
      await recordAuditEventInTransaction(tx, {
        action: auditActions.EMAIL_NOTIFICATION_BATCH_APPROVE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.EMAIL_NOTIFICATION,
        metadata: { notificationIds: ids, notificationCount: ids.length, deliveryCount },
      });
    }
    return {
      queuedCount: plans.length,
      deliveryCount,
      testModeRedirected: settings.testModeEnabled,
      message: `已批准 ${plans.length} 个邮件任务，等待发送`,
    };
  });
}

export async function cancelEmailNotification(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const id = notificationId(raw.notificationId);
  const ownerIds = await visibleOwnerIds(currentUser);
  return runInTransaction(async (tx) => {
    await lockNotificationRows(tx, [id]);
    const row = await findVisibleNotification(tx, ownerIds, id);
    if (!CANCELLABLE_STATUSES.has(row.status)) {
      throw createApiError({
        code: apiErrorCodes.CONFLICT,
        status: 409,
        message: '当前邮件状态不能取消',
        detail: { notificationId: id, status: row.status },
      });
    }
    const deliveries = await tx.emailDelivery.findMany({ where: { notificationId: id } });
    if (deliveries.some((delivery) => (
      delivery.status !== EmailDeliveryStatus.QUEUED
      && delivery.status !== EmailDeliveryStatus.FAILED
    ))) {
      throw createApiError({
        code: apiErrorCodes.CONFLICT,
        status: 409,
        message: '邮件已开始发送，不能取消',
      });
    }
    const cancelledDeliveries = await tx.emailDelivery.updateMany({
      where: { notificationId: id, status: { in: [EmailDeliveryStatus.QUEUED, EmailDeliveryStatus.FAILED] } },
      data: { status: EmailDeliveryStatus.CANCELLED, claimToken: null, claimExpiresAt: null, nextAttemptAt: null },
    });
    if (cancelledDeliveries.count !== deliveries.length) {
      throw createApiError({
        code: apiErrorCodes.CONFLICT,
        status: 409,
        message: '邮件已被发送服务接管，请刷新后确认状态',
      });
    }
    const updated = await tx.emailNotification.updateMany({
      where: { id, status: row.status },
      data: {
        status: EmailNotificationStatus.CANCELLED,
        correctionReason: 'ADMIN_CANCELLED',
        cancelledBy: currentUser.id,
        cancelledAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw createApiError({ code: apiErrorCodes.CONFLICT, status: 409, message: '邮件状态已变化' });
    }
    await recordAuditEventInTransaction(tx, {
      action: auditActions.EMAIL_NOTIFICATION_CANCEL,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EMAIL_NOTIFICATION,
      targetId: id,
      metadata: { beforeStatus: row.status, cancelledDeliveryCount: cancelledDeliveries.count },
    });
    return { message: '邮件任务已取消' };
  });
}

export async function retryEmailNotification(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const id = notificationId(raw.notificationId);
  const confirmUncertain = raw.confirmUncertain === true;
  const ownerIds = await visibleOwnerIds(currentUser);
  return runInTransaction(async (tx) => {
    await lockNotificationRows(tx, [id]);
    const row = await findVisibleNotification(tx, ownerIds, id);
    const deliveries = await tx.emailDelivery.findMany({ where: { notificationId: id } });
    const failed = deliveries.filter((delivery) => delivery.status === EmailDeliveryStatus.FAILED);
    const uncertain = deliveries.filter((delivery) => delivery.status === EmailDeliveryStatus.DELIVERY_UNCERTAIN);
    if (uncertain.length > 0 && !confirmUncertain && failed.length === 0) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_UNSAFE_RETRY,
        status: 409,
        message: '该邮件可能已经发出，确认承担重复发送风险后才能重试',
        detail: { notificationId: id, uncertainDeliveryCount: uncertain.length },
      });
    }
    const targets = [...failed, ...(confirmUncertain ? uncertain : [])];
    if (targets.length === 0) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_UNSAFE_RETRY,
        status: 409,
        message: '没有可安全重试的失败收件人',
        detail: { notificationId: id, status: row.status },
      });
    }
    await tx.emailDelivery.updateMany({
      where: { id: { in: targets.map((delivery) => delivery.id) } },
      data: {
        status: EmailDeliveryStatus.QUEUED,
        claimToken: null,
        claimExpiresAt: null,
        nextAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    await tx.emailNotification.update({
      where: { id },
      data: { status: EmailNotificationStatus.QUEUED },
    });
    await recordAuditEventInTransaction(tx, {
      action: auditActions.EMAIL_NOTIFICATION_RETRY,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EMAIL_NOTIFICATION,
      targetId: id,
      metadata: {
        beforeStatus: row.status,
        retriedDeliveryIds: targets.map((delivery) => delivery.id),
        uncertainRetryConfirmed: confirmUncertain && uncertain.length > 0,
      },
    });
    return { retriedCount: targets.length, message: '失败邮件已重新排队' };
  });
}

export async function createCorrectionNotification(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const id = notificationId(raw.notificationId);
  const ownerIds = await visibleOwnerIds(currentUser);
  return runInTransaction(async (tx) => {
    await lockNotificationRows(tx, [id]);
    const original = await findVisibleNotification(tx, ownerIds, id);
    if (original.status !== EmailNotificationStatus.NEEDS_CORRECTION) {
      throw createApiError({
        code: apiErrorCodes.EMAIL_SOURCE_CHANGED,
        status: 409,
        message: '该邮件不需要创建更正通知',
        detail: { notificationId: id, status: original.status },
      });
    }
    assertSourceAvailable(original);
    const priorCorrections = await tx.emailNotification.findMany({
      where: { parentNotificationId: original.id },
      orderBy: { createdAt: 'asc' },
    });
    const duplicate = priorCorrections.find((row) => (
      JSON.stringify(row.currentSnapshot) === JSON.stringify(original.currentSnapshot)
      && row.status !== EmailNotificationStatus.CANCELLED
    ));
    if (duplicate) {
      throw createApiError({
        code: apiErrorCodes.CONFLICT,
        status: 409,
        message: '当前业务变化已经创建过更正邮件',
        detail: { correctionNotificationId: duplicate.id },
      });
    }
    const status = original.customer!.notificationEmails.length > 0
      ? EmailNotificationStatus.PENDING
      : EmailNotificationStatus.MISSING_RECIPIENT;
    const correction = await tx.emailNotification.create({
      data: {
        eventKey: `CORRECTION:${original.id}:${priorCorrections.length + 1}`,
        type: original.type,
        status,
        customerId: original.customerId,
        receiptId: original.receiptId,
        invoiceId: original.invoiceId,
        parentNotificationId: original.id,
        sourceActorId: currentUser.id,
        currentSnapshot: snapshotObject(original.currentSnapshot) as Prisma.InputJsonValue,
        correctionReason: original.correctionReason || 'SOURCE_CHANGED',
      },
    });
    await recordAuditEventInTransaction(tx, {
      action: auditActions.EMAIL_NOTIFICATION_CORRECTION_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.EMAIL_NOTIFICATION,
      targetId: correction.id,
      metadata: { parentNotificationId: original.id, status },
    });
    return { notification: correction, message: '更正邮件任务已创建，请审核后发送' };
  });
}

export async function listEmailDeliveryAttempts(currentUser: CurrentUser, input: unknown) {
  const raw = inputRecord(input);
  const id = notificationId(raw.notificationId);
  const ownerIds = await visibleOwnerIds(currentUser);
  const row = await db.emailNotification.findFirst({
    where: { id, ...visibilityWhere(ownerIds) },
    select: { id: true },
  });
  if (!row) {
    throw createApiError({
      code: apiErrorCodes.RESOURCE_NOT_FOUND,
      status: 404,
      message: '邮件任务不存在或无权限',
    });
  }
  const deliveries = await db.emailDelivery.findMany({
    where: { notificationId: id },
    select: { id: true },
  });
  const rows = deliveries.length > 0
    ? await db.emailDeliveryAttempt.findMany({
        where: { deliveryId: { in: deliveries.map((delivery) => delivery.id) } },
        orderBy: [{ startedAt: 'desc' }, { attemptNo: 'desc' }],
      })
    : [];
  return {
    data: rows.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString() || null,
    })),
    message: `邮件发送记录已加载，共 ${rows.length} 条`,
  };
}
