import { UserRole } from '@prisma/client';
import { createHash } from 'crypto';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import { resolveOrderCustomer } from '@/lib/order-customer-lookup-service';
import type { CurrentUser } from '@/lib/request-auth';
import { customerAccessWhere } from '@/lib/customer-scope';
import { runInTransaction, type DbTransactionClient } from '@/lib/transaction';

export type CustomerConsigneePayload = {
  id: string;
  consignee: string;
  isPrimary: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type OrderConsigneeWriteResult = {
  written: boolean;
  orderNo: string;
  customerId: string;
  consigneeId: string;
  consignee: string;
  updatedAt: string;
};

type ConsigneeDbClient = Pick<typeof db, 'customer' | 'customerConsignee'> | Pick<DbTransactionClient, 'customer' | 'customerConsignee'>;

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function normalizeConsignee(value: unknown): string {
  return trimStr(value).replace(/\s+/g, ' ').toLowerCase();
}

function isBlankConsigneePlaceholder(value: unknown): boolean {
  const text = trimStr(value);
  return text === '-' || text === '－' || text === '—' || text === '–';
}

export function hashNormalizedConsignee(normalizedConsignee: string): string {
  return createHash('sha256').update(normalizedConsignee).digest('hex');
}

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function serializeConsignee(row: {
  id: string;
  consignee: string;
  isPrimary?: boolean | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}): CustomerConsigneePayload {
  return {
    id: row.id,
    consignee: row.consignee,
    isPrimary: Boolean(row.isPrimary),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
  };
}

function assertManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' });
  }
}

function assertConsigneeInput(consigneeInput: unknown): { consignee: string; normalizedConsignee: string } {
  const consignee = trimStr(consigneeInput).replace(/\s+/g, ' ');
  const normalizedConsignee = normalizeConsignee(consignee);
  if (!consignee || !normalizedConsignee || isBlankConsigneePlaceholder(consignee)) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'CONSIGNEE不能为空' });
  }
  return { consignee, normalizedConsignee };
}

async function assertCustomerVisible(currentUser: CurrentUser, customerId: string, client: ConsigneeDbClient = db) {
  const id = trimStr(customerId);
  if (!id) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: '客户ID不能为空' });
  }
  const customer = await client.customer.findFirst({
    where: {
      ...customerAccessWhere(currentUser),
      id,
    },
    select: { id: true, ownerId: true, consignee: true },
  });
  if (!customer) {
    throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: '客户不存在或无权限' });
  }
  return customer;
}

async function syncLegacyPrimaryConsignee(client: ConsigneeDbClient, customerId: string): Promise<void> {
  const remaining = await client.customerConsignee.findMany({
    where: { customerId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const primary = remaining.find((row) => !isBlankConsigneePlaceholder(row.consignee)) || null;
  if (primary) {
    await client.customerConsignee.updateMany({ where: { customerId }, data: { isPrimary: false } });
    await client.customerConsignee.updateMany({ where: { id: primary.id }, data: { isPrimary: true } });
    await client.customer.update({ where: { id: customerId }, data: { consignee: primary.consignee } });
    return;
  }
  await client.customer.update({ where: { id: customerId }, data: { consignee: null } });
}

async function existingConsignee(client: ConsigneeDbClient, customerId: string, normalizedConsigneeHash: string) {
  return client.customerConsignee.findFirst({
    where: { customerId, normalizedConsigneeHash },
  });
}

async function createConsigneeInCustomer(
  client: ConsigneeDbClient,
  customerId: string,
  consignee: string,
  normalizedConsignee: string,
  isPrimary: boolean,
) {
  const created = await client.customerConsignee.create({
    data: {
      customerId,
      consignee,
      normalizedConsignee,
      normalizedConsigneeHash: hashNormalizedConsignee(normalizedConsignee),
      isPrimary,
    },
  });
  if (isPrimary) {
    await client.customer.update({ where: { id: customerId }, data: { consignee } });
  }
  return created;
}

export async function ensureCustomerConsignee(
  client: ConsigneeDbClient,
  customerId: string,
  consigneeInput: unknown,
): Promise<{ row: { id: string; customerId: string; consignee: string; isPrimary?: boolean | null; updatedAt?: unknown }; written: boolean }> {
  const { consignee, normalizedConsignee } = assertConsigneeInput(consigneeInput);
  const normalizedConsigneeHash = hashNormalizedConsignee(normalizedConsignee);
  const currentRows = await client.customerConsignee.findMany({
    where: { customerId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const blankRows = currentRows.filter((row) => isBlankConsigneePlaceholder(row.consignee));
  const validRows = currentRows.filter((row) => !isBlankConsigneePlaceholder(row.consignee));
  const primaryWasBlank = blankRows.some((row) => Boolean(row.isPrimary));
  const hasValidPrimary = validRows.some((row) => Boolean(row.isPrimary));
  const shouldMakeWrittenPrimary = primaryWasBlank || !hasValidPrimary;
  const existing = await existingConsignee(client, customerId, normalizedConsigneeHash);
  if (existing) {
    for (const row of blankRows) {
      await client.customerConsignee.delete({ where: { id: row.id } });
    }
    if (shouldMakeWrittenPrimary) {
      await client.customerConsignee.updateMany({ where: { customerId }, data: { isPrimary: false } });
      await client.customerConsignee.updateMany({ where: { id: existing.id }, data: { isPrimary: true } });
      await client.customer.update({ where: { id: customerId }, data: { consignee: existing.consignee } });
      return { row: { ...existing, isPrimary: true }, written: false };
    }
    return { row: existing, written: false };
  }
  try {
    for (const row of blankRows) {
      await client.customerConsignee.delete({ where: { id: row.id } });
    }
    if (shouldMakeWrittenPrimary) {
      await client.customerConsignee.updateMany({ where: { customerId }, data: { isPrimary: false } });
    }
    const created = await createConsigneeInCustomer(client, customerId, consignee, normalizedConsignee, shouldMakeWrittenPrimary);
    return { row: created, written: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
      const row = await existingConsignee(client, customerId, normalizedConsigneeHash);
      if (row) return { row, written: false };
    }
    throw error;
  }
}

export async function syncCustomerPrimaryConsigneeFromLegacy(
  client: ConsigneeDbClient,
  customerId: string,
  consigneeInput: unknown,
): Promise<void> {
  const consignee = trimStr(consigneeInput);
  if (!consignee) return;
  await ensureCustomerConsignee(client, customerId, consignee);
}

export async function writeOrderConsignee(
  currentUser: CurrentUser,
  input: { orderNo: unknown; consignee: unknown },
): Promise<OrderConsigneeWriteResult> {
  const orderNo = trimStr(input.orderNo);
  if (!orderNo) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'ORDER NO不能为空' });
  }
  assertConsigneeInput(input.consignee);

  const matched = await resolveOrderCustomer(currentUser, orderNo);
  const result = await runInTransaction(async (tx) => {
    const { row, written } = await ensureCustomerConsignee(tx, matched.customerId, input.consignee);
    return { row, written };
  });

  await recordAuditEvent({
    action: auditActions.CUSTOMER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: matched.customerId,
    metadata: {
      source: 'order-consignee-write',
      orderNo,
      consigneeId: result.row.id,
      written: result.written,
    },
  });

  return {
    written: result.written,
    orderNo,
    customerId: matched.customerId,
    consigneeId: result.row.id,
    consignee: result.row.consignee,
    updatedAt: serializeDate(result.row.updatedAt) || new Date().toISOString(),
  };
}

export async function listCustomerConsignees(currentUser: CurrentUser, customerIdInput: string) {
  assertManager(currentUser);
  const customer = await assertCustomerVisible(currentUser, customerIdInput);
  const rows = await db.customerConsignee.findMany({
    where: { customerId: customer.id },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const visibleRows = rows.filter((row) => !isBlankConsigneePlaceholder(row.consignee));
  return {
    data: visibleRows.map(serializeConsignee),
    message: `CONSIGNEE已加载，共 ${visibleRows.length} 条`,
  };
}

export async function addCustomerConsignee(currentUser: CurrentUser, customerIdInput: string, consigneeInput: unknown) {
  assertManager(currentUser);
  const customerId = trimStr(customerIdInput);
  const result = await runInTransaction(async (tx) => {
    const customer = await assertCustomerVisible(currentUser, customerId, tx);
    return ensureCustomerConsignee(tx, customer.id, consigneeInput);
  });

  await recordAuditEvent({
    action: auditActions.CUSTOMER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: customerId,
    metadata: {
      source: 'customer-consignee-add',
      consigneeId: result.row.id,
      written: result.written,
    },
  });

  return {
    data: serializeConsignee(result.row),
    message: result.written ? 'CONSIGNEE已新增' : 'CONSIGNEE已存在',
  };
}

export async function deleteCustomerConsignee(currentUser: CurrentUser, customerIdInput: string, consigneeIdInput: string) {
  assertManager(currentUser);
  const customerId = trimStr(customerIdInput);
  const consigneeId = trimStr(consigneeIdInput);
  if (!consigneeId) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'CONSIGNEE ID不能为空' });
  }

  await runInTransaction(async (tx) => {
    const customer = await assertCustomerVisible(currentUser, customerId, tx);
    const existing = await tx.customerConsignee.findUnique({ where: { id: consigneeId } });
    if (!existing || existing.customerId !== customer.id) {
      throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: 'CONSIGNEE不存在或无权限' });
    }
    await tx.customerConsignee.delete({ where: { id: consigneeId } });
    await syncLegacyPrimaryConsignee(tx, customer.id);
  });

  await recordAuditEvent({
    action: auditActions.CUSTOMER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: customerId,
    metadata: {
      source: 'customer-consignee-delete',
      consigneeId,
    },
  });

  return { message: 'CONSIGNEE已删除' };
}

export async function setCustomerConsigneePrimary(currentUser: CurrentUser, customerIdInput: string, consigneeIdInput: string) {
  assertManager(currentUser);
  const customerId = trimStr(customerIdInput);
  const consigneeId = trimStr(consigneeIdInput);
  if (!consigneeId) {
    throw createApiError({ code: apiErrorCodes.VALIDATION_ERROR, status: 400, message: 'CONSIGNEE ID不能为空' });
  }

  const result = await runInTransaction(async (tx) => {
    const customer = await assertCustomerVisible(currentUser, customerId, tx);
    const existing = await tx.customerConsignee.findUnique({ where: { id: consigneeId } });
    if (!existing || existing.customerId !== customer.id) {
      throw createApiError({ code: apiErrorCodes.RESOURCE_NOT_FOUND, status: 404, message: 'CONSIGNEE不存在或无权限' });
    }
    await tx.customerConsignee.updateMany({ where: { customerId: customer.id }, data: { isPrimary: false } });
    await tx.customerConsignee.updateMany({ where: { id: consigneeId }, data: { isPrimary: true } });
    await tx.customer.update({ where: { id: customer.id }, data: { consignee: existing.consignee } });
    return { ...existing, isPrimary: true };
  });

  await recordAuditEvent({
    action: auditActions.CUSTOMER_UPDATE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: customerId,
    metadata: {
      source: 'customer-consignee-set-primary',
      consigneeId,
    },
  });

  return {
    data: serializeConsignee(result),
    message: '默认CONSIGNEE已更新',
  };
}
