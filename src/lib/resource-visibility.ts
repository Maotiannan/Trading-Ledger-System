import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/lib/request-auth';
import { getHierarchyScope } from '@/lib/user-hierarchy';

export function managedOwnershipWhere(ownerIds: string[]) {
  return { OR: [{ managedById: { in: ownerIds } }, { managedById: null, createdBy: { in: ownerIds } }] };
}

export async function getOwnerVisibleIds(currentUser: CurrentUser): Promise<string[]> {
  const scope = await getHierarchyScope(currentUser);
  return Array.from(scope.ownerVisibleIds);
}

export function buildOrderVisibilityWhere(ownerIds: string[], includeCanceled = false): Prisma.OrderWhereInput {
  return {
    ...(!includeCanceled ? { canceledAt: null } : {}),
    OR: [
      managedOwnershipWhere(ownerIds),
      { customer: { ownerId: { in: ownerIds } } },
    ],
  };
}

export function buildCustomerVisibilityWhere(ownerIds: string[]): Prisma.CustomerWhereInput {
  return {
    OR: [
      { ownerId: { in: ownerIds } },
      { orders: { some: managedOwnershipWhere(ownerIds) } },
      { receipts: { some: managedOwnershipWhere(ownerIds) } },
    ],
  };
}

export function buildInvoiceVisibilityWhere(ownerIds: string[], includeCanceled = false): Prisma.InvoiceWhereInput {
  return {
    ...(!includeCanceled ? { canceledAt: null } : {}),
    OR: [
      managedOwnershipWhere(ownerIds),
      { orders: { some: managedOwnershipWhere(ownerIds) } },
      { orders: { some: { customer: { ownerId: { in: ownerIds } } } } },
    ],
  };
}

export function buildReceiptVisibilityWhere(ownerIds: string[]): Prisma.ReceiptWhereInput {
  return {
    OR: [
      managedOwnershipWhere(ownerIds),
      { customer: { ownerId: { in: ownerIds } } },
      { order: managedOwnershipWhere(ownerIds) },
      { order: { customer: { ownerId: { in: ownerIds } } } },
    ],
  };
}

export function buildDetailVisibilityWhere(ownerIds: string[]): Prisma.DetailWhereInput {
  return {
    OR: [
      managedOwnershipWhere(ownerIds),
      { items: { some: { receipt: managedOwnershipWhere(ownerIds) } } },
      { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } },
    ],
  };
}

export function buildSwiftVisibilityWhere(ownerIds: string[]): Prisma.SwiftWhereInput {
  return {
    OR: [
      managedOwnershipWhere(ownerIds),
      { detail: managedOwnershipWhere(ownerIds) },
      { detail: { items: { some: { receipt: managedOwnershipWhere(ownerIds) } } } },
      { detail: { items: { some: { receipt: { customer: { ownerId: { in: ownerIds } } } } } } },
    ],
  };
}
