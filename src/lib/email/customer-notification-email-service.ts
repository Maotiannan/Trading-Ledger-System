import {
  CustomerEmailLanguage,
  EmailNotificationStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { recordAuditEventInTransaction } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { customerAccessWhere, canMutateCustomer } from '@/lib/customer-scope';
import { db } from '@/lib/db';
import { parseNotificationEmail } from '@/lib/email/email-address';
import type { CurrentUser } from '@/lib/request-auth';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

type NotificationEmailClient = Pick<
  DbTransactionClient,
  'customer' | 'customerNotificationEmail' | 'emailNotification' | 'auditLog' | '$queryRaw'
>;

type NotificationEmailRow = {
  id: string;
  email: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function trimString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function assertManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({
      code: apiErrorCodes.FORBIDDEN,
      status: 403,
      message: '无权限',
    });
  }
}

function parseLanguage(value: unknown): CustomerEmailLanguage {
  const language = trimString(value).toUpperCase();
  if (language === CustomerEmailLanguage.ENGLISH || language === CustomerEmailLanguage.FRENCH) {
    return language;
  }
  throw createApiError({
    code: apiErrorCodes.VALIDATION_ERROR,
    status: 400,
    message: '语言偏好无效',
  });
}

function serializeEmail(row: NotificationEmailRow) {
  return {
    id: row.id,
    email: row.email,
    isPrimary: row.isPrimary,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireMutableCustomer(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  client: Pick<NotificationEmailClient, 'customer'>,
) {
  assertManager(currentUser);
  const customerId = trimString(customerIdInput);
  if (!customerId) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '客户ID不能为空',
    });
  }
  const customer = await client.customer.findFirst({
    where: {
      ...customerAccessWhere(currentUser),
      id: customerId,
    },
    select: {
      id: true,
      ownerId: true,
      notificationLanguage: true,
    },
  });
  if (!customer || !canMutateCustomer(currentUser, customer.ownerId)) {
    throw createApiError({
      code: apiErrorCodes.RESOURCE_NOT_FOUND,
      status: 404,
      message: '客户不存在或无权限',
    });
  }
  return customer;
}

async function lockCustomerNotificationProfile(
  client: Pick<NotificationEmailClient, '$queryRaw'>,
  customerId: string,
): Promise<void> {
  await client.$queryRaw(Prisma.sql`
    SELECT id
    FROM Customer
    WHERE id = ${customerId}
    FOR UPDATE
  `);
}

function requireEmailId(value: unknown): string {
  const id = trimString(value);
  if (!id) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '邮箱ID不能为空',
    });
  }
  return id;
}

function duplicateEmailError() {
  return createApiError({
    code: apiErrorCodes.CONFLICT,
    status: 409,
    message: '该客户已存在相同邮箱',
  });
}

async function refreshEligibility(
  client: Pick<NotificationEmailClient, 'emailNotification'>,
  customerId: string,
  hasRecipients: boolean,
): Promise<void> {
  await client.emailNotification.updateMany({
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

async function auditCustomerEmailChange(
  client: Pick<NotificationEmailClient, 'auditLog'>,
  input: {
    currentUser: CurrentUser;
    customerId: string;
    source: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
): Promise<void> {
  await recordAuditEventInTransaction(client, {
    action: auditActions.CUSTOMER_UPDATE,
    actorId: input.currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: input.customerId,
    metadata: {
      source: input.source,
      before: input.before || null,
      after: input.after || null,
    },
  });
}

function mapDuplicateWrite(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw duplicateEmailError();
  }
  throw error;
}

export async function listCustomerNotificationEmails(
  currentUser: CurrentUser,
  customerIdInput: unknown,
) {
  const customer = await requireMutableCustomer(currentUser, customerIdInput, db);
  const rows = await db.customerNotificationEmail.findMany({
    where: { customerId: customer.id },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  return {
    data: rows.map(serializeEmail),
    language: customer.notificationLanguage,
    message: `客户通知邮箱已加载，共 ${rows.length} 个`,
  };
}

export async function addCustomerNotificationEmail(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  emailInput: unknown,
) {
  const parsed = parseNotificationEmail(emailInput);
  return runInTransaction(async (tx) => {
    const customer = await requireMutableCustomer(currentUser, customerIdInput, tx);
    await lockCustomerNotificationProfile(tx, customer.id);
    const duplicate = await tx.customerNotificationEmail.findFirst({
      where: { customerId: customer.id, normalizedEmail: parsed.normalizedEmail },
    });
    if (duplicate) throw duplicateEmailError();

    const existingRows = await tx.customerNotificationEmail.findMany({
      where: { customerId: customer.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    try {
      const created = await tx.customerNotificationEmail.create({
        data: {
          customerId: customer.id,
          email: parsed.email,
          normalizedEmail: parsed.normalizedEmail,
          isPrimary: existingRows.length === 0,
          createdBy: currentUser.id,
        },
      });
      await refreshEligibility(tx, customer.id, true);
      await auditCustomerEmailChange(tx, {
        currentUser,
        customerId: customer.id,
        source: 'customer-notification-email-add',
        after: { emailId: created.id, email: created.email, isPrimary: created.isPrimary },
      });
      return { data: serializeEmail(created), message: '客户通知邮箱已新增' };
    } catch (error) {
      return mapDuplicateWrite(error);
    }
  });
}

export async function updateCustomerNotificationEmail(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  emailIdInput: unknown,
  emailInput: unknown,
) {
  const emailId = requireEmailId(emailIdInput);
  const parsed = parseNotificationEmail(emailInput);
  return runInTransaction(async (tx) => {
    const customer = await requireMutableCustomer(currentUser, customerIdInput, tx);
    await lockCustomerNotificationProfile(tx, customer.id);
    const existing = await tx.customerNotificationEmail.findUnique({ where: { id: emailId } });
    if (!existing || existing.customerId !== customer.id) {
      throw createApiError({
        code: apiErrorCodes.RESOURCE_NOT_FOUND,
        status: 404,
        message: '邮箱不存在或无权限',
      });
    }
    const duplicate = await tx.customerNotificationEmail.findFirst({
      where: {
        customerId: customer.id,
        normalizedEmail: parsed.normalizedEmail,
        NOT: { id: emailId },
      },
    });
    if (duplicate) throw duplicateEmailError();

    try {
      const updated = await tx.customerNotificationEmail.update({
        where: { id: emailId },
        data: {
          email: parsed.email,
          normalizedEmail: parsed.normalizedEmail,
          updatedBy: currentUser.id,
        },
      });
      await refreshEligibility(tx, customer.id, true);
      await auditCustomerEmailChange(tx, {
        currentUser,
        customerId: customer.id,
        source: 'customer-notification-email-update',
        before: { emailId: existing.id, email: existing.email, isPrimary: existing.isPrimary },
        after: { emailId: updated.id, email: updated.email, isPrimary: updated.isPrimary },
      });
      return { data: serializeEmail(updated), message: '客户通知邮箱已更新' };
    } catch (error) {
      return mapDuplicateWrite(error);
    }
  });
}

export async function deleteCustomerNotificationEmail(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  emailIdInput: unknown,
) {
  const emailId = requireEmailId(emailIdInput);
  return runInTransaction(async (tx) => {
    const customer = await requireMutableCustomer(currentUser, customerIdInput, tx);
    await lockCustomerNotificationProfile(tx, customer.id);
    const rows = await tx.customerNotificationEmail.findMany({
      where: { customerId: customer.id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    const existing = rows.find((row) => row.id === emailId);
    if (!existing) {
      throw createApiError({
        code: apiErrorCodes.RESOURCE_NOT_FOUND,
        status: 404,
        message: '邮箱不存在或无权限',
      });
    }

    await tx.customerNotificationEmail.delete({ where: { id: emailId } });
    const remaining = rows.filter((row) => row.id !== emailId);
    if (remaining.length > 0 && (existing.isPrimary || !remaining.some((row) => row.isPrimary))) {
      await tx.customerNotificationEmail.updateMany({
        where: { customerId: customer.id },
        data: { isPrimary: false, updatedBy: currentUser.id },
      });
      await tx.customerNotificationEmail.updateMany({
        where: { id: remaining[0].id },
        data: { isPrimary: true, updatedBy: currentUser.id },
      });
    }
    await refreshEligibility(tx, customer.id, remaining.length > 0);
    await auditCustomerEmailChange(tx, {
      currentUser,
      customerId: customer.id,
      source: 'customer-notification-email-delete',
      before: { emailId: existing.id, email: existing.email, isPrimary: existing.isPrimary },
    });

    const currentRows = remaining.length > 0
      ? await tx.customerNotificationEmail.findMany({
          where: { customerId: customer.id },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        })
      : [];
    return {
      data: currentRows.map(serializeEmail),
      message: '客户通知邮箱已删除',
    };
  });
}

export async function setPrimaryCustomerNotificationEmail(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  emailIdInput: unknown,
) {
  const emailId = requireEmailId(emailIdInput);
  return runInTransaction(async (tx) => {
    const customer = await requireMutableCustomer(currentUser, customerIdInput, tx);
    await lockCustomerNotificationProfile(tx, customer.id);
    const existing = await tx.customerNotificationEmail.findUnique({ where: { id: emailId } });
    if (!existing || existing.customerId !== customer.id) {
      throw createApiError({
        code: apiErrorCodes.RESOURCE_NOT_FOUND,
        status: 404,
        message: '邮箱不存在或无权限',
      });
    }
    await tx.customerNotificationEmail.updateMany({
      where: { customerId: customer.id },
      data: { isPrimary: false, updatedBy: currentUser.id },
    });
    await tx.customerNotificationEmail.updateMany({
      where: { id: emailId },
      data: { isPrimary: true, updatedBy: currentUser.id },
    });
    await refreshEligibility(tx, customer.id, true);
    await auditCustomerEmailChange(tx, {
      currentUser,
      customerId: customer.id,
      source: 'customer-notification-email-set-primary',
      before: { emailId: existing.id, isPrimary: existing.isPrimary },
      after: { emailId: existing.id, isPrimary: true },
    });
    return {
      data: serializeEmail({ ...existing, isPrimary: true, updatedAt: new Date() }),
      message: '主通知邮箱已更新',
    };
  });
}

export async function updateCustomerNotificationLanguage(
  currentUser: CurrentUser,
  customerIdInput: unknown,
  languageInput: unknown,
) {
  const language = parseLanguage(languageInput);
  return runInTransaction(async (tx) => {
    const customer = await requireMutableCustomer(currentUser, customerIdInput, tx);
    await lockCustomerNotificationProfile(tx, customer.id);
    const updated = await tx.customer.update({
      where: { id: customer.id },
      data: { notificationLanguage: language },
      select: { notificationLanguage: true },
    });
    await auditCustomerEmailChange(tx, {
      currentUser,
      customerId: customer.id,
      source: 'customer-notification-language-update',
      before: { language: customer.notificationLanguage },
      after: { language: updated.notificationLanguage },
    });
    return {
      language: updated.notificationLanguage,
      message: '客户语言偏好已更新',
    };
  });
}
