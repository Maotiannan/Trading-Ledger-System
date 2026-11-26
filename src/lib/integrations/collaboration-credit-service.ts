import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { CollaborationCreditError } from './collaboration-credit-http';
import { toCollaborationCreditRecord } from './collaboration-credit-record';

const SORT = 'creditRecordId:asc';
const CURSOR_DOMAIN = 'collaboration-credit-records-v1';
const sourceSelect = {
  id: true, companyName: true, credit: true, companyAddress: true, companyContact: true, updatedAt: true,
} satisfies Prisma.CustomerSelect;

function invalidCursor(): never {
  throw new CollaborationCreditError(400, 'INVALID_CURSOR', 'Cursor is invalid for this credit source listing.');
}

function signCursor(payload: string, secret: string, domain = CURSOR_DOMAIN) {
  return createHmac('sha256', secret).update(`${domain}:${payload}`).digest('base64url');
}

export function encodeCreditCursor(id: string, secret: string, domain = CURSOR_DOMAIN) {
  const payload = Buffer.from(JSON.stringify({ v: 1, sort: SORT, id })).toString('base64url');
  return `${payload}.${signCursor(payload, secret, domain)}`;
}

function decodeCursor(cursor: string, secret: string, domain = CURSOR_DOMAIN): string {
  if (cursor.length > 2048 || !/^[\w-]+\.[\w-]+$/.test(cursor)) invalidCursor();
  const [payload, signature] = cursor.split('.');
  const expected = signCursor(payload, secret, domain);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) invalidCursor();
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.v !== 1 || decoded.sort !== SORT || typeof decoded.id !== 'string' || !decoded.id || decoded.id.length > 191) invalidCursor();
    return decoded.id;
  } catch { return invalidCursor(); }
}

export function parseCreditPageInput(params: URLSearchParams, cursorSecret: string, domain = CURSOR_DOMAIN) {
  for (const key of params.keys()) {
    if (!['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) {
      throw new CollaborationCreditError(400, 'INVALID_QUERY', 'Only one limit and one cursor parameter are supported.');
    }
  }
  const rawLimit = params.get('limit');
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1)) {
    throw new CollaborationCreditError(400, 'INVALID_QUERY', 'limit must be a positive integer.');
  }
  const limit = Math.min(Number(rawLimit ?? 20), 50);
  const lastId = params.has('cursor') ? decodeCursor(params.get('cursor')!, cursorSecret, domain) : null;
  return { limit, lastId };
}

export async function listCollaborationCreditRecords(params: URLSearchParams, cursorSecret: string) {
  const { limit, lastId } = parseCreditPageInput(params, cursorSecret);
  const rows = await db.customer.findMany({
    where: { credit: { gt: 0 }, ...(lastId ? { id: { gt: lastId } } : {}) },
    select: sourceSelect, orderBy: { id: 'asc' }, take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items: page.map(toCollaborationCreditRecord),
    nextCursor: hasMore ? encodeCreditCursor(page[page.length - 1].id, cursorSecret) : null,
    hasMore, readAt: new Date().toISOString(),
  };
}

export async function readCollaborationCreditRecord(creditRecordId: string) {
  if (!creditRecordId || creditRecordId.length > 191 || creditRecordId.trim() !== creditRecordId) {
    throw new CollaborationCreditError(400, 'INVALID_QUERY', 'Invalid creditRecordId.');
  }
  const source = await db.customer.findUnique({ where: { id: creditRecordId }, select: sourceSelect });
  if (!source) throw new CollaborationCreditError(404, 'CREDIT_RECORD_NOT_FOUND', 'Credit source record has been deleted or does not exist.');
  return toCollaborationCreditRecord(source);
}
