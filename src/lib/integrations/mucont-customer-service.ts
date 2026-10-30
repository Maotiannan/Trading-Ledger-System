import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { dedupeOrderNameAliases, normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import { MucontCustomerError } from './mucont-customer-http';

const SORT = 'customerId:asc';
const candidateSelect = { id: true, mark: true, name: true, companyName: true } satisfies Prisma.CustomerSelect;

function nullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function invalidCursor(): never {
  throw new MucontCustomerError(400, 'INVALID_CURSOR', 'Cursor is invalid or belongs to a different query.');
}

function signCursor(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`mucont-customers-v1:${payload}`).digest('base64url');
}

function encodeCursor(id: string, q: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, sort: SORT, q, id })).toString('base64url');
  return `${payload}.${signCursor(payload, secret)}`;
}

function decodeCursor(cursor: string, q: string, secret: string): string {
  if (cursor.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(cursor)) invalidCursor();
  const [payload, signature] = cursor.split('.');
  const expected = signCursor(payload, secret);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) invalidCursor();
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.v !== 1 || decoded.sort !== SORT || decoded.q !== q || typeof decoded.id !== 'string' || !decoded.id || decoded.id.length > 191) invalidCursor();
    return decoded.id;
  } catch {
    return invalidCursor();
  }
}

export async function listMucontCustomerOptions(params: URLSearchParams, cursorSecret: string) {
  const q = (params.get('q') || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (q.length > 200) throw new MucontCustomerError(400, 'INVALID_QUERY', 'q must not exceed 200 characters.');
  const rawLimit = params.get('limit');
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1)) {
    throw new MucontCustomerError(400, 'INVALID_QUERY', 'limit must be a positive integer.');
  }
  const limit = Math.min(Number(rawLimit ?? 20), 50);
  const cursor = params.get('cursor');
  const lastId = cursor ? decodeCursor(cursor, q, cursorSecret) : null;
  const normalized = normalizeOrderIdentifier(q);
  const where: Prisma.CustomerWhereInput = {
    ...(lastId ? { id: { gt: lastId } } : {}),
    ...(q ? { OR: [
      { name: { contains: q } }, { companyName: { contains: q } },
      { mark: { contains: q } }, { normalizedMark: { contains: normalized } },
      { orderName: { contains: q } },
      { orderNames: { some: { OR: [
        { orderName: { contains: q } }, { normalizedOrderName: { contains: normalized } },
      ] } } },
    ] } : {}),
  };
  // Root Customer query + relation predicate naturally deduplicates aliases and excludes no owners.
  const rows = await db.customer.findMany({ where, select: candidateSelect, orderBy: { id: 'asc' }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((row) => ({ customerId: row.id, mark: nullableText(row.mark), name: nullableText(row.name), companyName: nullableText(row.companyName) })),
    nextCursor: hasMore ? encodeCursor(page[page.length - 1].id, q, cursorSecret) : null,
    hasMore,
  };
}

function consigneeText(value: string | null | undefined): string | null {
  const text = nullableText(value);
  return text && !/^[-－—–]$/.test(text) ? text : null;
}

export async function readMucontCustomerProfile(customerId: string) {
  if (!customerId || customerId.length > 191 || customerId.trim() !== customerId) {
    throw new MucontCustomerError(400, 'INVALID_QUERY', 'Invalid customerId.');
  }
  return db.$transaction(async (tx) => {
    const row = await tx.customer.findUnique({
      where: { id: customerId },
      select: {
        ...candidateSelect, companyAddress: true, phone: true, city: true, orderName: true, consignee: true,
        orderNames: { select: { orderName: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] },
        consignees: { select: { consignee: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new MucontCustomerError(404, 'CUSTOMER_NOT_FOUND', 'Customer has been deleted or does not exist.', customerId);
    const primary = consigneeText(row.consignees.find((item) => item.isPrimary)?.consignee)
      || consigneeText(row.consignee) || row.consignees.map((item) => consigneeText(item.consignee)).find(Boolean) || null;
    const consignees: string[] = [];
    const seen = new Set<string>();
    for (const value of [primary, ...row.consignees.map((item) => item.consignee), row.consignee]) {
      const text = consigneeText(value);
      if (!text) continue;
      const normalized = text.replace(/\s+/g, ' ').toLowerCase();
      if (!seen.has(normalized)) { seen.add(normalized); consignees.push(text); }
    }
    return {
      customerId: row.id, capturedAt: new Date().toISOString(), completeness: 'MASTER_FULL' as const,
      profile: {
        name: nullableText(row.name), companyName: nullableText(row.companyName),
        companyAddress: nullableText(row.companyAddress), phone: nullableText(row.phone), city: nullableText(row.city),
        mark: nullableText(row.mark),
        orderNames: dedupeOrderNameAliases([row.orderName, ...row.orderNames.map((item) => item.orderName)]).map((item) => item.orderName),
        consignee: primary, consignees,
      },
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
