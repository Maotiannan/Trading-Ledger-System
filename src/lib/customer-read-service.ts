import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { createApiError } from '@/lib/api-error';
import type { CurrentUser } from '@/lib/request-auth';
import { customerAccessWhere, splitPhoneCandidates } from '@/lib/customer-scope';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import { filterRowsBySearch } from '@/lib/text-search';
import { canSalesEditExtendedCustomerFields } from '@/lib/customer-service';

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: 'FORBIDDEN', status: 403, message: '无权限' });
  }
}

function toSalesView<T extends Record<string, unknown>>(row: T, showExtended: boolean): T {
  if (showExtended) return row;
  return {
    ...row,
    companyName: null,
    companyAddress: null,
    credit: null,
  };
}

function annotatePhoneConflicts<T extends Record<string, unknown>>(rows: T[]): Array<T & { phoneConflict: boolean; phoneConflictMessage: string }> {
  const tokenBuckets = new Map<string, Set<string>>();

  for (const row of rows) {
    const id = String(row.id || '');
    const ownerId = String(row.ownerId || '');
    if (!id || !ownerId) continue;
    for (const token of splitPhoneCandidates(String(row.phone || ''))) {
      const bucketKey = `${ownerId}:${token}`;
      if (!tokenBuckets.has(bucketKey)) tokenBuckets.set(bucketKey, new Set());
      tokenBuckets.get(bucketKey)!.add(id);
    }
  }

  const conflictedIds = new Set<string>();
  for (const ids of tokenBuckets.values()) {
    if (ids.size < 2) continue;
    for (const id of ids) conflictedIds.add(id);
  }

  return rows.map((row) => ({
    ...row,
    phoneConflict: conflictedIds.has(String(row.id || '')),
    phoneConflictMessage: conflictedIds.has(String(row.id || '')) ? '手机号冲突，请修改' : '',
  }));
}

export async function listCustomerOwnerOptions(currentUser: CurrentUser) {
  ensureManager(currentUser);

  const options = currentUser.role === UserRole.ADMIN
    ? await db.user.findMany({
        where: {
          OR: [
            { id: currentUser.id },
            { role: UserRole.SALES },
          ],
        },
        select: { id: true, email: true, name: true, role: true, level: true },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      })
    : [
        {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role,
          level: currentUser.level,
        },
      ];

  await recordAuditEvent({
    action: auditActions.CUSTOMER_OWNER_OPTIONS_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      count: options.length,
      currentRole: currentUser.role,
    },
  });

  return { data: options, message: `客户归属候选已加载，共 ${options.length} 个账号` };
}

export async function listCustomers(
  currentUser: CurrentUser,
  filters: { mark?: string | null; search?: string | null },
) {
  ensureManager(currentUser);

  const where: Record<string, unknown> = {
    ...customerAccessWhere(currentUser),
  };

  const mark = trimStr(filters.mark);
  const search = trimStr(filters.search);

  const rows = await db.customer.findMany({
    where,
    include: {
      orderNames: {
        select: {
          orderName: true,
          normalizedOrderName: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      owner: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          level: true,
        },
      },
    },
    orderBy: [{ mark: 'asc' }, { createdAt: 'desc' }],
  });

  const showExtended = currentUser.role === UserRole.ADMIN || await canSalesEditExtendedCustomerFields();
  const conflictAnnotatedRows = annotatePhoneConflicts(rows as Array<Record<string, unknown>>);
  const normalizedMark = mark ? normalizeOrderIdentifier(mark) : '';
  const markedRows = normalizedMark
    ? conflictAnnotatedRows.filter((row) => normalizeOrderIdentifier(trimStr(row.mark)) === normalizedMark)
    : conflictAnnotatedRows;
  const data = currentUser.role === UserRole.ADMIN
    ? filterRowsBySearch(markedRows, search)
    : filterRowsBySearch(markedRows.map((row) => toSalesView(row as Record<string, unknown>, showExtended)), search);

  await recordAuditEvent({
    action: auditActions.CUSTOMER_LIST_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      count: data.length,
      mark,
      search,
      showExtended,
    },
  });

  return { data, message: `客户列表已加载，共 ${data.length} 个客户` };
}
