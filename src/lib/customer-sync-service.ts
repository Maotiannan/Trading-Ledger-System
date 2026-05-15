import { UserRole } from '@prisma/client';
import { recordAuditEvent } from '@/lib/audit';
import { auditActions, auditTargetTypes } from '@/lib/audit-catalog';
import { apiErrorCodes, createApiError } from '@/lib/api-error';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';
import { customerAccessWhere } from '@/lib/customer-scope';
import { canSalesEditExtendedCustomerFields } from '@/lib/customer-service';

const DEFAULT_SYNC_LIMIT = 500;
const MAX_SYNC_LIMIT = 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

type StreamCursor = {
  updatedAt?: string;
  deletedAt?: string;
  id: string;
};

export type CustomerSyncCursor = {
  customer?: StreamCursor;
  deleted?: StreamCursor;
};

type CustomerSyncInput = {
  since?: unknown;
  limit?: unknown;
};

type CustomerRow = Awaited<ReturnType<typeof db.customer.findMany>>[number] & {
  orderNames?: Array<{
    orderName: string;
    normalizedOrderName?: string;
    isPrimary?: boolean;
  }>;
};

type DeleteAuditRow = Awaited<ReturnType<typeof db.auditLog.findMany>>[number];

type SyncEvent =
  | { kind: 'customer'; id: string; changedAt: Date; row: CustomerRow }
  | { kind: 'deleted'; id: string; changedAt: Date; row: DeleteAuditRow };

function trimStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseDate(value: unknown, label: string): Date {
  const text = trimStr(value);
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: `${label}无效`,
      detail: { value },
    });
  }
  return date;
}

function parseLimit(value: unknown): number {
  const raw = trimStr(value);
  if (!raw) return DEFAULT_SYNC_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '同步limit无效',
      detail: { limit: value },
    });
  }
  return Math.min(parsed, MAX_SYNC_LIMIT);
}

function normalizeStreamCursor(value: unknown, dateKey: 'updatedAt' | 'deletedAt'): StreamCursor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const dateText = trimStr(row[dateKey]);
  const id = trimStr(row.id);
  if (!dateText && !id) return undefined;
  parseDate(dateText, '同步游标');
  return { [dateKey]: new Date(dateText).toISOString(), id } as StreamCursor;
}

export function encodeCustomerSyncCursor(cursor: CustomerSyncCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCustomerSyncCursor(raw: unknown): CustomerSyncCursor {
  const text = trimStr(raw);
  if (!text) return {};

  const directDate = new Date(text);
  if (!Number.isNaN(directDate.getTime())) {
    const iso = directDate.toISOString();
    return {
      customer: { updatedAt: iso, id: '' },
      deleted: { deletedAt: iso, id: '' },
    };
  }

  try {
    const decoded = Buffer.from(text, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return {
      customer: normalizeStreamCursor(parsed.customer, 'updatedAt'),
      deleted: normalizeStreamCursor(parsed.deleted, 'deletedAt'),
    };
  } catch {
    throw createApiError({
      code: apiErrorCodes.BAD_REQUEST,
      status: 400,
      message: '同步游标无效',
    });
  }
}

function ensureManager(currentUser: CurrentUser): void {
  if (currentUser.role !== UserRole.ADMIN && currentUser.role !== UserRole.SALES) {
    throw createApiError({ code: apiErrorCodes.FORBIDDEN, status: 403, message: '无权限' });
  }
}

function streamDate(cursor: StreamCursor | undefined, dateKey: 'updatedAt' | 'deletedAt'): Date {
  return parseDate(cursor?.[dateKey] || EPOCH_ISO, '同步游标');
}

function streamId(cursor: StreamCursor | undefined): string {
  return trimStr(cursor?.id);
}

function buildCustomerWindow(cursor: StreamCursor | undefined, highWatermark: Date) {
  const updatedAt = streamDate(cursor, 'updatedAt');
  const id = streamId(cursor);
  return [
    { updatedAt: { gt: updatedAt, lte: highWatermark } },
    { updatedAt, id: { gt: id } },
  ];
}

function buildDeleteWindow(cursor: StreamCursor | undefined, highWatermark: Date) {
  const deletedAt = streamDate(cursor, 'deletedAt');
  const id = streamId(cursor);
  return [
    { createdAt: { gt: deletedAt, lte: highWatermark } },
    { createdAt: deletedAt, id: { gt: id } },
  ];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function shouldExposeDeleteTombstone(currentUser: CurrentUser, row: DeleteAuditRow): boolean {
  if (currentUser.role === UserRole.ADMIN) return true;
  const ownerId = trimStr(metadataRecord(row.metadata).ownerId);
  return ownerId === currentUser.id;
}

function orderNamesFor(row: CustomerRow): string[] {
  const names = [
    row.orderName,
    ...(row.orderNames || []).map((item) => item.orderName),
  ].map(trimStr).filter(Boolean);
  return Array.from(new Set(names));
}

function serializeCustomer(row: CustomerRow, showExtended: boolean) {
  return {
    id: row.id,
    mark: row.mark,
    normalizedMark: row.normalizedMark,
    orderName: row.orderName,
    orderNames: orderNamesFor(row),
    name: row.name,
    phone: row.phone,
    city: row.city,
    consignee: row.consignee,
    companyName: showExtended ? row.companyName : null,
    companyAddress: showExtended ? row.companyAddress : null,
    credit: showExtended && row.credit !== null && row.credit !== undefined ? Number(row.credit) : null,
    ownerId: row.ownerId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    syncState: 'UPSERT' as const,
  };
}

function serializeDeleted(row: DeleteAuditRow) {
  const metadata = metadataRecord(row.metadata);
  return {
    id: trimStr(row.targetId),
    ownerId: trimStr(metadata.ownerId) || null,
    mark: trimStr(metadata.mark) || null,
    orderName: trimStr(metadata.orderName) || null,
    deletedAt: row.createdAt.toISOString(),
    deletedBy: row.actorId,
    syncState: 'DELETED' as const,
  };
}

function compareEvents(left: SyncEvent, right: SyncEvent): number {
  const timeDiff = left.changedAt.getTime() - right.changedAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  const kindDiff = left.kind.localeCompare(right.kind);
  if (kindDiff !== 0) return kindDiff;
  return left.id.localeCompare(right.id);
}

function nextStreamCursor(
  previous: StreamCursor | undefined,
  fetched: SyncEvent[],
  selected: SyncEvent[],
  highWatermark: Date,
  dateKey: 'updatedAt' | 'deletedAt',
): StreamCursor {
  const consumed = selected.at(-1);
  const hasUnconsumed = fetched.length > selected.length;
  if (consumed) {
    return { [dateKey]: consumed.changedAt.toISOString(), id: consumed.id } as StreamCursor;
  }
  if (hasUnconsumed && previous) return previous;
  return { [dateKey]: highWatermark.toISOString(), id: '' } as StreamCursor;
}

export async function syncCustomers(currentUser: CurrentUser, input: CustomerSyncInput) {
  ensureManager(currentUser);

  const cursor = decodeCustomerSyncCursor(input.since);
  const limit = parseLimit(input.limit);
  const highWatermark = new Date();
  const showExtended = currentUser.role === UserRole.ADMIN || (await canSalesEditExtendedCustomerFields());

  const customerRows = await db.customer.findMany({
    where: {
      ...customerAccessWhere(currentUser),
      OR: buildCustomerWindow(cursor.customer, highWatermark),
    },
    include: {
      orderNames: {
        select: {
          orderName: true,
          normalizedOrderName: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  }) as CustomerRow[];

  const deleteRows = (await db.auditLog.findMany({
    where: {
      action: auditActions.CUSTOMER_DELETE,
      targetType: auditTargetTypes.CUSTOMER,
      OR: buildDeleteWindow(cursor.deleted, highWatermark),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  })).filter((row) => shouldExposeDeleteTombstone(currentUser, row));

  const customerEvents: SyncEvent[] = customerRows.map((row) => ({
    kind: 'customer',
    id: row.id,
    changedAt: row.updatedAt,
    row,
  }));
  const deleteEvents: SyncEvent[] = deleteRows.map((row) => ({
    kind: 'deleted',
    id: row.id,
    changedAt: row.createdAt,
    row,
  }));

  const selectedEvents = [...customerEvents, ...deleteEvents].sort(compareEvents).slice(0, limit);
  const selectedCustomerEvents = selectedEvents.filter((event): event is Extract<SyncEvent, { kind: 'customer' }> => event.kind === 'customer');
  const selectedDeleteEvents = selectedEvents.filter((event): event is Extract<SyncEvent, { kind: 'deleted' }> => event.kind === 'deleted');

  const nextCursor = encodeCustomerSyncCursor({
    customer: nextStreamCursor(cursor.customer, customerEvents, selectedCustomerEvents, highWatermark, 'updatedAt'),
    deleted: nextStreamCursor(cursor.deleted, deleteEvents, selectedDeleteEvents, highWatermark, 'deletedAt'),
  });
  const hasMore = customerEvents.length + deleteEvents.length > selectedEvents.length;

  await recordAuditEvent({
    action: auditActions.CUSTOMER_SYNC_VIEW,
    actorId: currentUser.id,
    targetType: auditTargetTypes.CUSTOMER,
    metadata: {
      customerCount: selectedCustomerEvents.length,
      deletedCount: selectedDeleteEvents.length,
      hasMore,
      limit,
      highWatermark: highWatermark.toISOString(),
    },
  });

  return {
    data: {
      customers: selectedCustomerEvents.map((event) => serializeCustomer(event.row, showExtended)),
      deleted: selectedDeleteEvents.map((event) => serializeDeleted(event.row)),
      disabled: [] as never[],
      nextCursor,
      hasMore,
    },
    message: '客户同步完成',
  };
}
