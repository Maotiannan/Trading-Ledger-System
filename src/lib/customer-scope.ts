import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';

export type CustomerUniqueInput = {
  orderName: string;
  phone: string;
  companyName?: string | null;
};

export type CustomerDuplicateSummary = {
  id: string;
  mark: string;
  orderName: string;
  name: string;
  phone: string;
  ownerId: string;
  ownerEmail: string;
};

type CustomerCollision = {
  id: string;
  orderName: string;
  phone: string;
  companyName: string | null;
};

export function normalizeCompanyName(value: string | null | undefined): string | null {
  const normalized = (value || '').trim();
  return normalized || null;
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhoneToken(value: string | null | undefined): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized.replace(/[^a-z0-9]/g, '');
}

function splitPhoneCandidates(value: string | null | undefined): string[] {
  const raw = (value || '').trim();
  if (!raw) return [];
  return Array.from(new Set(raw.split('/').map((part) => normalizePhoneToken(part)).filter(Boolean)));
}

export function customerAccessWhere(currentUser: CurrentUser): Prisma.CustomerWhereInput {
  if (currentUser.role === UserRole.ADMIN) {
    return {};
  }
  return { ownerId: currentUser.id };
}

export function canMutateCustomer(currentUser: CurrentUser, ownerId: string): boolean {
  if (currentUser.role === UserRole.ADMIN) {
    return true;
  }
  return ownerId === currentUser.id;
}

export async function resolveCustomerOwnerId(currentUser: CurrentUser, requestedOwnerId?: string | null): Promise<string> {
  const candidate = (requestedOwnerId || '').trim();
  if (currentUser.role !== UserRole.ADMIN) {
    return currentUser.id;
  }
  if (!candidate) {
    return currentUser.id;
  }

  const owner = await db.user.findUnique({
    where: { id: candidate },
    select: { id: true, role: true },
  });
  if (!owner) {
    throw new Error('指定绑定账户不存在');
  }
  if (owner.role !== UserRole.ADMIN && owner.role !== UserRole.SALES) {
    throw new Error('客户绑定账户必须为ADMIN或SALES');
  }
  return owner.id;
}

async function findScopeCollisions(
  ownerId: string,
  input: CustomerUniqueInput,
  excludeId?: string,
  options?: { includePhone?: boolean }
): Promise<CustomerCollision[]> {
  const conditions: Prisma.CustomerWhereInput[] = [
    { orderName: { equals: input.orderName } },
  ];
  if (options?.includePhone !== false) {
    conditions.push({ phone: { equals: input.phone } });
  }
  if (input.companyName) {
    conditions.push({ companyName: { equals: input.companyName } });
  }

  return db.customer.findMany({
    where: {
      ownerId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: conditions,
    },
    select: {
      id: true,
      orderName: true,
      phone: true,
      companyName: true,
    },
  });
}

export async function assertNoCustomerScopeConflict(ownerId: string, input: CustomerUniqueInput, excludeId?: string): Promise<void> {
  const companyName = normalizeCompanyName(input.companyName);
  const collisions = await findScopeCollisions(ownerId, { ...input, companyName }, excludeId, { includePhone: false });
  if (collisions.length === 0) return;

  const duplicatedFields = new Set<string>();
  for (const row of collisions) {
    if (row.orderName === input.orderName) duplicatedFields.add('ORDER_NAME');
    if (companyName && row.companyName === companyName) duplicatedFields.add('COMPANY_NAME');
  }

  const fields = Array.from(duplicatedFields);
  if (fields.length === 0) {
    throw new Error('客户数据冲突，请检查 ORDER_NAME/COMPANY_NAME');
  }
  throw new Error(`同一绑定池内 ${fields.join('/')} 不允许重复`);
}

export async function resolveCustomerUpsertTargetId(ownerId: string, input: CustomerUniqueInput): Promise<string | null> {
  const companyName = normalizeCompanyName(input.companyName);
  const collisions = await findScopeCollisions(ownerId, { ...input, companyName }, undefined, { includePhone: true });
  if (collisions.length === 0) return null;

  const byId = new Map<string, CustomerCollision>();
  for (const row of collisions) byId.set(row.id, row);
  if (byId.size === 1) {
    return collisions[0].id;
  }

  const orderNameHits = collisions.filter((row) => row.orderName === input.orderName).map((row) => row.id);
  const phoneHits = collisions.filter((row) => row.phone === input.phone).map((row) => row.id);
  const companyHits = companyName
    ? collisions.filter((row) => row.companyName === companyName).map((row) => row.id)
    : [];

  const allIds = new Set([...orderNameHits, ...phoneHits, ...companyHits]);
  if (allIds.size === 1) {
    return [...allIds][0];
  }

  throw new Error('同一绑定池中 ORDER_NAME/PHONE/COMPANY_NAME 命中多条不同客户，无法自动导入');
}

export async function findDuplicateCustomersInScope(
  ownerId: string,
  input: { mark: string; name: string; phone: string },
  excludeId?: string
): Promise<CustomerDuplicateSummary[]> {
  const normalizedMark = normalizeMatchText(input.mark);
  const normalizedName = normalizeMatchText(input.name);
  const inputPhoneTokens = splitPhoneCandidates(input.phone);
  if (!normalizedMark && !normalizedName && inputPhoneTokens.length === 0) return [];

  const rows = await db.customer.findMany({
    where: {
      ownerId,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: {
      id: true,
      mark: true,
      orderName: true,
      name: true,
      phone: true,
      ownerId: true,
      owner: { select: { email: true } },
    },
  });

  return rows.filter((row) => {
    const markNameMatched = normalizedMark &&
      normalizedName &&
      normalizeMatchText(row.mark) === normalizedMark &&
      normalizeMatchText(row.name) === normalizedName;
    const phoneMatched = inputPhoneTokens.length > 0 &&
      splitPhoneCandidates(row.phone).some((token) => inputPhoneTokens.includes(token));
    return markNameMatched || phoneMatched;
  }).map((row) => ({
    id: row.id,
    mark: row.mark,
    orderName: row.orderName,
    name: row.name,
    phone: row.phone,
    ownerId: row.ownerId,
    ownerEmail: row.owner.email,
  }));
}

export function mapPrismaWriteError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return '唯一约束冲突，请检查重复数据';
    if (error.code === 'P2000') return '字段长度超限，请缩短文本后重试';
    if (error.code === 'P2003') return '关联数据不存在或已失效';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '数据库错误';
}
