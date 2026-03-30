import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';

export async function getOwnerVisibleIds(currentUser: CurrentUser): Promise<string[]> {
  const scope = await getHierarchyScope(currentUser);
  return Array.from(scope.ownerVisibleIds);
}

export function buildOrderVisibilityWhere(ownerIds: string[]): Prisma.OrderWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { customer: { ownerId: { in: ownerIds } } },
    ],
  };
}

export function buildInvoiceVisibilityWhere(ownerIds: string[]): Prisma.InvoiceWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { orders: { some: { createdBy: { in: ownerIds } } } },
      { orders: { some: { customer: { ownerId: { in: ownerIds } } } } },
    ],
  };
}

export function buildReceiptVisibilityWhere(ownerIds: string[]): Prisma.ReceiptWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { customer: { ownerId: { in: ownerIds } } },
      { order: { createdBy: { in: ownerIds } } },
      { order: { customer: { ownerId: { in: ownerIds } } } },
    ],
  };
}

export function buildDetailVisibilityWhere(ownerIds: string[]): Prisma.DetailWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { items: { some: { receipt: { createdBy: { in: ownerIds } } } } },
      { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } },
    ],
  };
}

export function buildSwiftVisibilityWhere(ownerIds: string[]): Prisma.SwiftWhereInput {
  return {
    OR: [
      { createdBy: { in: ownerIds } },
      { detail: { createdBy: { in: ownerIds } } },
      { detail: { items: { some: { receipt: { createdBy: { in: ownerIds } } } } } },
      { detail: { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } } },
    ],
  };
}
