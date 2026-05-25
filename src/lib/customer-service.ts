import { UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  findDuplicateCustomersInScope,
  findPhoneConflictCustomersInScope,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
} from '@/lib/customer-scope';
import { syncCustomerOrderNames } from '@/lib/customer-order-name-service';
import { syncCustomerPrimaryConsigneeFromLegacy } from '@/lib/customer-consignee-service';
import { runInTransaction } from '@/lib/transaction';

export type CustomerPayload = {
  mark?: string;
  orderName?: string;
  orderNames?: string[];
  name?: string;
  phone?: string;
  city?: string;
  consignee?: string | null;
  companyName?: string | null;
  credit?: number | null;
  companyAddress?: string | null;
};

export type ImportRow = {
  rowNo: number;
  payload: CustomerPayload;
  ownerEmail?: string | null;
};

export type CustomerImportIssueRow = {
  rowNo: number;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerEmail: string;
  reason: string;
};

export type CustomerImportRowResult = {
  rowNo: number;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  city: string;
  consignee: string;
  companyName: string;
  credit: string;
  companyAddress: string;
  ownerEmail: string;
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED';
  reason: string;
};

export type CustomerImportProcessResult = {
  success: boolean;
  status: number;
  message: string;
  details: string[];
  issueRows: CustomerImportIssueRow[];
  rowResults: CustomerImportRowResult[];
  createdCount: number;
  updatedCount: number;
  createdRows: string[];
  updatedRows: string[];
};

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function hasMeaningfulContent(value: string | null | undefined): boolean {
  const normalized = trimStr(value);
  if (!normalized) return false;
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(normalized);
}

function normalizeMarkForMatch(value: string | null | undefined): string {
  return trimStr(value).replace(/\s+/g, ' ').toLowerCase();
}

function normalizeNameForMatch(value: string | null | undefined): string {
  return trimStr(value).replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhoneToken(value: string | null | undefined): string {
  const normalized = trimStr(value).toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/[^a-z0-9]/g, '');
}

function splitPhoneCandidates(value: string | null | undefined): string[] {
  const raw = trimStr(value);
  if (!raw) return [];
  const parts = raw
    .split('/')
    .map((item) => normalizePhoneToken(item))
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function formatCustomerSummary(name: string | null | undefined, mark: string | null | undefined, phone: string | null | undefined): string {
  return `${trimStr(name) || '-'} / ${trimStr(mark) || '-'} / ${trimStr(phone) || '-'}`;
}

function toCustomerImportIssueRow(row: ImportRow, reason: string): CustomerImportIssueRow {
  const payload = row.payload;
  return {
    rowNo: row.rowNo,
    mark: trimStr(payload.mark),
    orderName: trimStr(payload.orderName),
    name: trimStr(payload.name),
    phone: trimStr(payload.phone),
    city: trimStr(payload.city),
    consignee: trimStr(payload.consignee),
    companyName: trimStr(payload.companyName),
    credit: payload.credit === null || payload.credit === undefined || Number.isNaN(payload.credit) ? '' : String(payload.credit),
    companyAddress: trimStr(payload.companyAddress),
    ownerEmail: trimStr(row.ownerEmail || ''),
    reason,
  };
}

function toCustomerImportRowResult(
  row: ImportRow,
  status: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'FAILED',
  reason: string,
): CustomerImportRowResult {
  const payload = row.payload;
  return {
    rowNo: row.rowNo,
    mark: trimStr(payload.mark),
    orderName: trimStr(payload.orderName),
    name: trimStr(payload.name),
    phone: trimStr(payload.phone),
    city: trimStr(payload.city),
    consignee: trimStr(payload.consignee),
    companyName: trimStr(payload.companyName),
    credit: payload.credit === null || payload.credit === undefined || Number.isNaN(payload.credit) ? '' : String(payload.credit),
    companyAddress: trimStr(payload.companyAddress),
    ownerEmail: trimStr(row.ownerEmail || ''),
    status,
    reason,
  };
}

function validateRequired(payload: CustomerPayload): string | null {
  if (!payload.mark) return 'MARK不能为空';
  if (!payload.orderName) return 'ORDER_NAME不能为空';
  if (!payload.name) return 'NAME不能为空';
  if (!payload.phone) return 'PHONE不能为空';
  if (!payload.city) return 'CITY不能为空';
  if ((payload.mark?.length || 0) > 191) return 'MARK长度不能超过191';
  if ((payload.orderName?.length || 0) > 191) return 'ORDER_NAME长度不能超过191';
  if (Array.isArray(payload.orderNames) && payload.orderNames.some((item) => trimStr(item).length > 191)) {
    return '附加ORDER_NAME长度不能超过191';
  }
  if ((payload.phone?.length || 0) > 191) return 'PHONE长度不能超过191';
  if ((payload.city?.length || 0) > 191) return 'CITY长度不能超过191';
  if (payload.credit !== null && payload.credit !== undefined) {
    if (!Number.isFinite(payload.credit) || payload.credit < 0) return 'CREDIT必须为大于等于0的数字';
  }
  return null;
}

export function formatDuplicateCustomerMessage(
  rows: Array<{ id: string; mark: string; orderName: string; name: string; phone: string; ownerEmail?: string | null }>
): string {
  const details = rows
    .map((row) => `MARK=${trimStr(row.mark) || '-'} / NAME=${trimStr(row.name) || '-'} / PHONE=${trimStr(row.phone) || '-'} / BINDING=${trimStr(row.ownerEmail) || '-'} / ID=${row.id}`)
    .join('\n');
  return `发现重复客户：\n${details}`;
}

function mapCustomerError(error: unknown, fallback = '数据库错误') {
  return mapPrismaWriteError(error) || fallback;
}

function asApiError(error: unknown, messageFallback = '数据库错误') {
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
    return error;
  }
  throw createApiError({
    code: 'BAD_REQUEST',
    status: 400,
    message: mapCustomerError(error, messageFallback),
  });
}

export async function canSalesEditExtendedCustomerFields(): Promise<boolean> {
  const settings = await getSystemSettings(['SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS']);
  return (settings.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS || 'false').toLowerCase() === 'true';
}

export async function createCustomerRecord(
  currentUser: CurrentUser,
  payload: CustomerPayload,
  requestedOwnerId?: string | null,
) {
  const error = validateRequired(payload);
  if (error) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: error });
  }

  const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedCustomerFields());
  try {
    let created;
    let ownerId = currentUser.id;
    let phoneConflict = false;
    await runInTransaction(async (tx) => {
      ownerId = await resolveCustomerOwnerId(currentUser, requestedOwnerId || null, tx);
      const duplicates = await findDuplicateCustomersInScope(ownerId, {
        mark: payload.mark!,
        name: payload.name!,
        phone: payload.phone!,
      }, undefined, tx);
      if (duplicates.length > 0) {
        throw createApiError({ code: 'CUSTOMER_DUPLICATE', status: 400, message: formatDuplicateCustomerMessage(duplicates) });
      }

      await assertNoCustomerScopeConflict(ownerId, {
        orderName: payload.orderName!,
        phone: payload.phone!,
        companyName: showExtended ? payload.companyName || null : null,
      }, undefined, tx);

      created = await tx.customer.create({
        data: {
          mark: payload.mark!,
          normalizedMark: normalizeMarkForMatch(payload.mark!),
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          companyName: showExtended ? payload.companyName : null,
          companyAddress: showExtended ? payload.companyAddress : null,
          credit: showExtended ? payload.credit : null,
          createdBy: currentUser.id,
          ownerId,
        },
      });
      await syncCustomerOrderNames(tx as unknown as Parameters<typeof syncCustomerOrderNames>[0], created.id, payload.orderName!, payload.orderNames || []);
      await syncCustomerPrimaryConsigneeFromLegacy(tx, created.id, payload.consignee || null);

      const phoneConflicts = await findPhoneConflictCustomersInScope(ownerId, payload.phone!, created.id, tx);
      phoneConflict = phoneConflicts.length > 0;
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_CREATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.CUSTOMER,
      targetId: created.id,
      metadata: {
        ownerId,
        mark: created.mark,
        orderName: created.orderName,
        source: 'manual',
      },
    });

    return {
      data: {
        ...created,
        phoneConflict,
        phoneConflictMessage: phoneConflict ? '手机号冲突，请修改' : '',
      },
      message: '客户已创建',
      showExtended,
    };
  } catch (error) {
    asApiError(error, '客户创建失败');
    throw error;
  }
}

export async function updateCustomerRecord(
  currentUser: CurrentUser,
  idInput: string,
  payload: CustomerPayload,
  requestedOwnerId?: string | null,
) {
  const id = trimStr(idInput);
  if (!id) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '客户ID不能为空' });
  }

  const error = validateRequired(payload);
  if (error) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: error });
  }

  const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedCustomerFields());
  const existing = await db.customer.findUnique({
    where: { id },
    select: { id: true, ownerId: true, mark: true, orderName: true, name: true, phone: true },
  });
  if (!existing) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '客户不存在' });
  }
  if (currentUser.role !== UserRole.ADMIN && existing.ownerId !== currentUser.id) {
    throw createApiError({ code: 'CUSTOMER_SCOPE_FORBIDDEN', status: 403, message: '无权修改该客户' });
  }

  try {
    let updated;
    let ownerId = existing.ownerId;
    let phoneConflict = false;
    await runInTransaction(async (tx) => {
      ownerId = await resolveCustomerOwnerId(currentUser, requestedOwnerId || existing.ownerId, tx);
      const duplicates = await findDuplicateCustomersInScope(ownerId, {
        mark: payload.mark!,
        name: payload.name!,
        phone: payload.phone!,
      }, id, tx);
      if (duplicates.length > 0) {
        throw createApiError({ code: 'CUSTOMER_DUPLICATE', status: 400, message: formatDuplicateCustomerMessage(duplicates) });
      }
      await assertNoCustomerScopeConflict(ownerId, {
        orderName: payload.orderName!,
        phone: payload.phone!,
        companyName: showExtended ? payload.companyName || null : null,
      }, id, tx);

      updated = await tx.customer.update({
        where: { id },
        data: {
          mark: payload.mark!,
          normalizedMark: normalizeMarkForMatch(payload.mark!),
          orderName: payload.orderName!,
          name: payload.name!,
          phone: payload.phone!,
          city: payload.city!,
          consignee: payload.consignee || null,
          ownerId,
          ...(showExtended
            ? {
                companyName: payload.companyName,
                companyAddress: payload.companyAddress,
                credit: payload.credit,
              }
            : {}),
        },
      });
      await syncCustomerOrderNames(tx as unknown as Parameters<typeof syncCustomerOrderNames>[0], id, payload.orderName!, payload.orderNames || []);
      await syncCustomerPrimaryConsigneeFromLegacy(tx, id, payload.consignee || null);

      const phoneConflicts = await findPhoneConflictCustomersInScope(ownerId, payload.phone!, id, tx);
      phoneConflict = phoneConflicts.length > 0;
    });

    await recordAuditEvent({
      action: auditActions.CUSTOMER_UPDATE,
      actorId: currentUser.id,
      targetType: auditTargetTypes.CUSTOMER,
      targetId: id,
      metadata: {
        previousOwnerId: existing.ownerId,
        nextOwnerId: ownerId,
        previousMark: existing.mark,
        nextMark: payload.mark!,
        previousOrderName: existing.orderName,
        nextOrderName: payload.orderName!,
      },
    });

    return {
      data: {
        ...updated,
        phoneConflict,
        phoneConflictMessage: phoneConflict ? '手机号冲突，请修改' : '',
      },
      message: '客户已更新',
      showExtended,
    };
  } catch (error) {
    asApiError(error, '客户更新失败');
    throw error;
  }
}

export async function deleteCustomerRecord(currentUser: CurrentUser, idInput: string) {
  if (currentUser.role !== UserRole.ADMIN) {
    throw createApiError({ code: 'ROLE_NOT_ALLOWED', status: 403, message: '只有管理员可删除客户' });
  }

  const id = trimStr(idInput);
  if (!id) {
    throw createApiError({ code: 'VALIDATION_ERROR', status: 400, message: '客户ID不能为空' });
  }

  const existing = await db.customer.findUnique({
    where: { id },
    select: { id: true, mark: true, orderName: true, ownerId: true },
  });
  if (!existing) {
    throw createApiError({ code: 'RESOURCE_NOT_FOUND', status: 404, message: '客户不存在' });
  }

  await runInTransaction((tx) => tx.customer.delete({ where: { id } }));

  await recordAuditEvent({
    action: auditActions.CUSTOMER_DELETE,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    targetId: id,
    metadata: {
      ownerId: existing.ownerId,
      mark: existing.mark,
      orderName: existing.orderName,
    },
  });

  return { message: '客户已删除' };
}

export async function processCustomerImportRows(
  rows: ImportRow[],
  currentUser: Pick<CurrentUser, 'id' | 'role'> & CurrentUser,
  ownerIdFallback: string,
): Promise<CustomerImportProcessResult> {
  const issueRows: CustomerImportIssueRow[] = [];
  const rowResults: CustomerImportRowResult[] = [];
  if (rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: '没有可导入的数据行',
      details: [],
      issueRows: [],
      rowResults: [],
      createdCount: 0,
      updatedCount: 0,
      createdRows: [],
      updatedRows: [],
    };
  }

  const ownerEmailToId = new Map<string, string>();
  if (currentUser.role === UserRole.ADMIN && rows.some((row) => !!row.ownerEmail)) {
    const ownerEmails = Array.from(new Set(rows.map((row) => (row.ownerEmail || '').trim().toLowerCase()).filter(Boolean)));
    const ownerUsers = await db.user.findMany({
      where: { role: UserRole.SALES, email: { in: ownerEmails } },
      select: { id: true, email: true },
    });
    for (const owner of ownerUsers) ownerEmailToId.set(owner.email.toLowerCase(), owner.id);
  }

  const ownerEmailCache = new Map<string, string>();
  const resolveOwnerEmail = async (ownerId: string): Promise<string> => {
    if (!ownerEmailCache.has(ownerId)) {
      const owner = await db.user.findUnique({ where: { id: ownerId }, select: { email: true } });
      ownerEmailCache.set(ownerId, owner?.email || ownerId);
    }
    return ownerEmailCache.get(ownerId)!;
  };

  const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedCustomerFields());
  let createdCount = 0;
  const updatedCount = 0;
  const unchangedCount = 0;
  const createdRows: string[] = [];
  const updatedRows: string[] = [];

  for (const row of rows) {
    const payload = row.payload;
    const requiredError = validateRequired(payload);
    if (requiredError) {
      issueRows.push(toCustomerImportIssueRow(row, requiredError));
      rowResults.push(toCustomerImportRowResult(row, 'FAILED', requiredError));
      continue;
    }

    const rowOwnerId = row.ownerEmail
      ? ownerEmailToId.get((row.ownerEmail || '').toLowerCase()) || null
      : ownerIdFallback;

    if (row.ownerEmail && currentUser.role === UserRole.ADMIN && !rowOwnerId) {
      const reason = `SALES_EMAIL不存在或不是销售账号: ${row.ownerEmail}`;
      issueRows.push(toCustomerImportIssueRow(row, reason));
      rowResults.push(toCustomerImportRowResult(row, 'FAILED', reason));
      continue;
    }

    const effectiveOwnerId = rowOwnerId || ownerIdFallback;

    try {
      const ownerEmail = await resolveOwnerEmail(effectiveOwnerId);
      const duplicates = await findDuplicateCustomersInScope(effectiveOwnerId, {
        mark: payload.mark!,
        name: payload.name!,
        phone: payload.phone!,
      });
      if (duplicates.length > 0) {
        const reason = formatDuplicateCustomerMessage(duplicates.map((item) => ({ ...item, ownerEmail })));
        issueRows.push(toCustomerImportIssueRow(row, reason));
        rowResults.push(toCustomerImportRowResult(row, 'FAILED', reason));
        continue;
      }

      let created;
      await runInTransaction(async (tx) => {
        await assertNoCustomerScopeConflict(effectiveOwnerId, {
          orderName: payload.orderName!,
          phone: payload.phone!,
          companyName: showExtended ? payload.companyName || null : null,
        }, undefined, tx);

        created = await tx.customer.create({
          data: {
            mark: payload.mark!,
            normalizedMark: normalizeMarkForMatch(payload.mark!),
            orderName: payload.orderName!,
            name: payload.name!,
            phone: payload.phone!,
            city: payload.city!,
            consignee: payload.consignee || null,
            companyName: showExtended ? payload.companyName || null : null,
            companyAddress: showExtended ? payload.companyAddress || null : null,
            credit: showExtended ? payload.credit ?? null : null,
            createdBy: currentUser.id,
            ownerId: effectiveOwnerId,
          },
        });
        await syncCustomerOrderNames(tx as unknown as Parameters<typeof syncCustomerOrderNames>[0], created.id, payload.orderName!, payload.orderNames || []);
        await syncCustomerPrimaryConsigneeFromLegacy(tx, created.id, payload.consignee || null);
      });

      await recordAuditEvent({
        action: auditActions.CUSTOMER_CREATE,
        actorId: currentUser.id,
        targetType: auditTargetTypes.CUSTOMER,
        targetId: created.id,
        metadata: {
          ownerId: effectiveOwnerId,
          mark: created.mark,
          orderName: created.orderName,
          source: 'import',
          rowNo: row.rowNo,
        },
      });
      createdCount++;
      createdRows.push(formatCustomerSummary(payload.name, payload.mark, payload.phone));
      rowResults.push(toCustomerImportRowResult(row, 'CREATED', ''));
    } catch (error) {
      const reason = mapCustomerError(error);
      issueRows.push(toCustomerImportIssueRow(row, reason));
      rowResults.push(toCustomerImportRowResult(row, 'FAILED', reason));
    }
  }

  if (createdCount > 0) {
    await recordAuditEvent({
      action: auditActions.CUSTOMER_IMPORT,
      actorId: currentUser.id,
      targetType: auditTargetTypes.CUSTOMER,
      targetId: ownerIdFallback,
      metadata: {
        ownerId: ownerIdFallback,
        totalRows: rows.length,
        createdCount,
        failedCount: issueRows.length,
      },
    });
  }

  const totalSuccess = createdCount + updatedCount;
  if (totalSuccess === 0 && issueRows.length > 0) {
    return {
      success: false,
      status: 400,
      message: '导入失败：所有行均未成功',
      details: issueRows.map((issueRow) => `第${issueRow.rowNo}行(NAME=${issueRow.name || '-'})：${issueRow.reason}`),
      issueRows,
      rowResults: rowResults.sort((a, b) => a.rowNo - b.rowNo),
      createdCount,
      updatedCount,
      createdRows,
      updatedRows,
    };
  }

  return {
    success: true,
    status: 200,
    message: `导入完成：新增 ${createdCount}，更新 ${updatedCount}，无变更 ${unchangedCount}，失败 ${issueRows.length} 行`,
    details: issueRows.map((issueRow) => `第${issueRow.rowNo}行(NAME=${issueRow.name || '-'})：${issueRow.reason}`),
    issueRows,
    rowResults: rowResults.sort((a, b) => a.rowNo - b.rowNo),
    createdCount,
    updatedCount,
    createdRows,
    updatedRows,
  };
}
