import { db } from '@/lib/db';
import { buildCompositeOrderLookupCandidates, dedupeOrderNameAliases, normalizeOrderIdentifier } from '@/lib/order-name-kernel';

export type CustomerOrderNameWrite = {
  customerId: string;
  orderName: string;
  normalizedOrderName: string;
  isPrimary: boolean;
};

export function buildCustomerOrderNameWrites(
  customerId: string,
  primaryOrderName: string,
  additionalOrderNames: Array<string | null | undefined> = [],
): CustomerOrderNameWrite[] {
  const primaryNormalized = normalizeOrderIdentifier(primaryOrderName);
  return dedupeOrderNameAliases([primaryOrderName, ...additionalOrderNames]).map((item) => ({
    customerId,
    orderName: item.orderName,
    normalizedOrderName: item.normalizedOrderName,
    isPrimary: item.normalizedOrderName === primaryNormalized,
  }));
}

export async function syncCustomerOrderNames(
  tx: {
    customerOrderName: {
      deleteMany(args: { where: { customerId: string } }): Promise<unknown>;
      createMany(args: { data: CustomerOrderNameWrite[] }): Promise<unknown>;
    };
  },
  customerId: string,
  primaryOrderName: string,
  additionalOrderNames: Array<string | null | undefined> = [],
) {
  const rows = buildCustomerOrderNameWrites(customerId, primaryOrderName, additionalOrderNames);
  await tx.customerOrderName.deleteMany({ where: { customerId } });
  await tx.customerOrderName.createMany({ data: rows });
  return rows;
}

export async function findCustomerOrderNameMatches(ownerIds: string[] | null | undefined, orderInput: string | null | undefined) {
  const normalizedCandidates = buildCompositeOrderLookupCandidates(orderInput).orderNameCandidates
    .map((row) => row.normalizedOrderName)
    .filter(Boolean);
  if (normalizedCandidates.length === 0) return [];

  const rows = await db.customerOrderName.findMany({
    where: {
      normalizedOrderName: normalizedCandidates.length === 1
        ? normalizedCandidates[0]
        : { in: normalizedCandidates },
      ...(Array.isArray(ownerIds) && ownerIds.length > 0
        ? { customer: { ownerId: { in: ownerIds } } }
        : {}),
    },
    include: {
      customer: {
        select: {
          id: true,
          mark: true,
          orderName: true,
          name: true,
          phone: true,
          city: true,
          consignee: true,
          companyName: true,
          companyAddress: true,
          credit: true,
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  });

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.customer.id)) return false;
    seen.add(row.customer.id);
    return true;
  });
}
