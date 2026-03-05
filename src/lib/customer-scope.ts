import { Prisma, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';

export type CustomerUniqueInput = {
  orderName: string;
  phone: string;
  companyName?: string | null;
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

async function findScopeCollisions(ownerId: string, input: CustomerUniqueInput, excludeId?: string): Promise<CustomerCollision[]> {
  const conditions: Prisma.CustomerWhereInput[] = [
    { orderName: { equals: input.orderName } },
    { phone: { equals: input.phone } },
  ];
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
  const collisions = await findScopeCollisions(ownerId, { ...input, companyName }, excludeId);
  if (collisions.length === 0) return;

  const duplicatedFields = new Set<string>();
  for (const row of collisions) {
    if (row.orderName === input.orderName) duplicatedFields.add('ORDER_NAME');
    if (row.phone === input.phone) duplicatedFields.add('PHONE');
    if (companyName && row.companyName === companyName) duplicatedFields.add('COMPANY_NAME');
  }

  const fields = Array.from(duplicatedFields);
  if (fields.length === 0) {
    throw new Error('客户数据冲突，请检查 ORDER_NAME/PHONE/COMPANY_NAME');
  }
  throw new Error(`同一绑定池内 ${fields.join('/')} 不允许重复`);
}

export async function resolveCustomerUpsertTargetId(ownerId: string, input: CustomerUniqueInput): Promise<string | null> {
  const companyName = normalizeCompanyName(input.companyName);
  const collisions = await findScopeCollisions(ownerId, { ...input, companyName });
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
