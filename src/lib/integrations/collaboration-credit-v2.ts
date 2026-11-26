import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runInTransaction } from '@/lib/transaction';
import { executeMutationIntent } from '@/lib/mutation-intent';
import { customerCreditCodeError } from '@/lib/customer-credit-codes';
import { assertNoCustomerScopeConflict } from '@/lib/customer-scope';
import { syncCustomerOrderNames } from '@/lib/customer-order-name-service';
import { CollaborationCreditError } from './collaboration-credit-http';
import { toCollaborationCreditRecord } from './collaboration-credit-record';
import { encodeCreditCursor, parseCreditPageInput } from './collaboration-credit-service';

const DOMAIN = 'collaboration-credit-records-v2';
const select = { id: true, companyName: true, credit: true, companyAddress: true, companyContact: true,
  updatedAt: true, customerCode: true, creditCode: true, orderName: true, phone: true } satisfies Prisma.CustomerSelect;
type Source = Prisma.CustomerGetPayload<{ select: typeof select }>;
type Field = 'customerCode' | 'creditCode' | 'orderName' | 'companyName' | 'creditAmount' | 'currency' | 'address' | 'phone';
const allowed: Field[] = ['customerCode', 'creditCode', 'orderName', 'companyName', 'creditAmount', 'currency', 'address', 'phone'];
const clean = (v: string | null) => v?.trim() || null;
const fail = (message: string): never => { throw new CollaborationCreditError(400, 'VALIDATION_ERROR', message); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const idCheck = (id: string) => { if (!id || id.length > 191 || id.trim() !== id) fail('Invalid creditRecordId.'); };

export function toCollaborationCreditRecordV2(source: Source) {
  const record = { ...toCollaborationCreditRecord(source), sourceVersion: undefined,
    customerCode: clean(source.customerCode), creditCode: clean(source.creditCode),
    orderName: source.orderName, phone: source.phone };
  for (const key of ['customerCode', 'creditCode'] as const) if (record[key] === null) record.missingFields.push(key);
  return { ...record, sourceVersion: `sha256:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}` };
}

export function parseCreditWriteback(value: unknown) {
  if (!object(value) || Object.keys(value).some(k => !['requestId', 'expectedSourceVersion', 'confirmation', 'actor', 'fields'].includes(k))) fail('Invalid writeback request.');
  const body = value as Record<string, unknown>;
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(body.requestId)) fail('A valid requestId is required.');
  if (typeof body.expectedSourceVersion !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(body.expectedSourceVersion)) fail('expectedSourceVersion is required.');
  if (body.confirmation !== 'MODIFY_WRITEBACK_CONFIRM') fail('Explicit modify/writeback confirmation is required.');
  if (!object(body.actor) || Object.keys(body.actor).some(k => !['id', 'name'].includes(k))
    || typeof body.actor.id !== 'string' || !body.actor.id.trim() || body.actor.id.length > 191
    || typeof body.actor.name !== 'string' || !body.actor.name.trim() || body.actor.name.length > 191) fail('The authenticated MuCont actor is required.');
  if (!object(body.fields) || !Object.keys(body.fields).length || Object.keys(body.fields).some(k => !allowed.includes(k as Field))) fail('Only the documented credit fields may be changed.');
  const fields: Partial<Record<Field, string | null>> = {};
  for (const key of allowed) {
    if (!Object.hasOwn(body.fields as object, key)) continue;
    const raw = (body.fields as Record<string, unknown>)[key];
    if (key === 'currency') { if (raw !== 'USD') fail('Currency must remain USD.'); fields.currency = 'USD'; continue; }
    if (key === 'creditAmount') {
      if (raw !== null && (typeof raw !== 'string' || !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(raw))) fail('creditAmount must be an exact nonnegative decimal string or null.');
      fields.creditAmount = raw === null ? null : new Prisma.Decimal(raw as string).toFixed(2); continue;
    }
    if (raw !== null && typeof raw !== 'string') fail(`${key} must be text or null.`);
    const text = clean(raw as string | null);
    if ((key === 'orderName' || key === 'phone') && !text) fail(`${key} cannot be empty.`);
    if ((text?.length || 0) > (['companyName', 'address'].includes(key) ? 10000 : 191)) fail(`${key} is too long.`);
    fields[key] = key === 'orderName' ? text!.toUpperCase() : text;
  }
  return { requestId: body.requestId as string, expectedSourceVersion: body.expectedSourceVersion as string,
    confirmation: 'MODIFY_WRITEBACK_CONFIRM' as const, actor: body.actor as { id: string; name: string }, fields };
}

export async function listCreditRecordsV2(params: URLSearchParams, secret: string) {
  const rawIncludeZero = params.get('includeZero');
  if (params.getAll('includeZero').length > 1 || (rawIncludeZero !== null && !['true', 'false'].includes(rawIncludeZero))) {
    throw new CollaborationCreditError(400, 'INVALID_QUERY', 'includeZero must be a single true or false value.');
  }
  const includeZero = rawIncludeZero === 'true';
  const pageParams = new URLSearchParams(params);
  pageParams.delete('includeZero');
  // Preserve existing default cursors while binding opt-in cursors to their source set.
  const domain = includeZero ? `${DOMAIN}:include-zero` : DOMAIN;
  const { limit, lastId } = parseCreditPageInput(pageParams, secret, domain);
  const rows = await db.customer.findMany({ where: { credit: includeZero ? { gte: 0 } : { gt: 0 }, ...(lastId ? { id: { gt: lastId } } : {}) },
    select, orderBy: { id: 'asc' }, take: limit + 1 });
  const page = rows.slice(0, limit), hasMore = rows.length > limit;
  return { items: page.map(toCollaborationCreditRecordV2), hasMore,
    nextCursor: hasMore ? encodeCreditCursor(page[page.length - 1].id, secret, domain) : null, readAt: new Date().toISOString() };
}

export async function readCreditRecordV2(id: string) {
  idCheck(id);
  const source = await db.customer.findUnique({ where: { id }, select });
  if (!source) throw new CollaborationCreditError(404, 'CREDIT_RECORD_NOT_FOUND', 'Credit source does not exist.');
  return toCollaborationCreditRecordV2(source);
}

export async function writeCreditRecordV2(id: string, input: unknown, principalId: string) {
  idCheck(id);
  const payload = parseCreditWriteback(input);
  // Read the current row after lock acquisition, not an earlier transaction snapshot.
  return runInTransaction(async tx => {
    const principal = await tx.user.findUnique({ where: { id: principalId }, select: { role: true, disabledAt: true } });
    if (!principal || principal.role !== 'ADMIN' || principal.disabledAt) throw new CollaborationCreditError(503, 'SERVICE_UNAVAILABLE', 'Writeback audit principal is unavailable.');
    return executeMutationIntent(tx, { actorId: `collaboration:mucont:${principalId}`, kind: 'COLLABORATION_CREDIT_WRITEBACK', requestId: payload.requestId, payload: { creditRecordId: id, ...payload } }, async () => {
      await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${id} FOR UPDATE`;
      const source = await tx.customer.findUnique({ where: { id }, select: { ...select, ownerId: true } });
      if (!source) throw new CollaborationCreditError(404, 'CREDIT_RECORD_NOT_FOUND', 'Credit source does not exist.');
      const before = toCollaborationCreditRecordV2(source);
      if (before.sourceVersion !== payload.expectedSourceVersion) throw new CollaborationCreditError(409, 'SOURCE_VERSION_CONFLICT', 'Credit source changed; reload and confirm the changes again.');
      const f = payload.fields;
      const data = {
        customerCode: f.customerCode === undefined ? source.customerCode : f.customerCode,
        creditCode: f.creditCode === undefined ? source.creditCode : f.creditCode,
        orderName: f.orderName === undefined ? source.orderName : f.orderName!,
        phone: f.phone === undefined ? source.phone : f.phone!,
        companyName: f.companyName === undefined ? source.companyName : f.companyName,
        companyAddress: f.address === undefined ? source.companyAddress : f.address,
        credit: f.creditAmount === undefined ? source.credit : f.creditAmount === null ? null : new Prisma.Decimal(f.creditAmount),
      };
      const codesError = customerCreditCodeError(data.credit, data.customerCode, data.creditCode);
      if (codesError) fail(codesError);
      if (data.orderName !== source.orderName || data.companyName !== source.companyName) {
        try { await assertNoCustomerScopeConflict(source.ownerId, data, id, tx as unknown as Parameters<typeof assertNoCustomerScopeConflict>[3]); }
        catch { throw new CollaborationCreditError(409, 'CUSTOMER_SCOPE_CONFLICT', 'The updated ORDER NAME or company conflicts with an existing customer in the same pool.'); }
      }
      const updated = await tx.customer.update({ where: { id }, data, select });
      if (data.orderName !== source.orderName) {
        const aliases = await tx.customerOrderName.findMany({ where: { customerId: id, isPrimary: false }, select: { orderName: true } });
        await syncCustomerOrderNames(tx, id, data.orderName, aliases.map(a => a.orderName));
      }
      const record = toCollaborationCreditRecordV2(updated);
      const audit = await tx.auditLog.create({ data: { actorId: principalId, action: 'COLLABORATION_CREDIT_WRITEBACK', targetType: 'CUSTOMER', targetId: id,
        metadata: { service: 'mucont', scope: 'credit-records:write', requestId: payload.requestId, confirmation: payload.confirmation,
          externalActor: payload.actor, before, after: record } } });
      return { written: true, requestId: payload.requestId, auditId: audit.id, record } as Prisma.InputJsonObject;
    });
  }, { isolationLevel: 'ReadCommitted' });
}
