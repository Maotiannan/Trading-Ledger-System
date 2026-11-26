import { dedupeOrderNameAliases, normalizeOrderIdentifier } from '@/lib/order-name-kernel';
import type { Prisma } from '@prisma/client';

export type CustomerBusinessProfile = {
  orderName?: string | null;
  mark?: string | null;
  orderNames?: ReadonlyArray<{ orderName: string }>;
};

export const customerBusinessSelect = {
  orderName: true,
  mark: true,
  orderNames: {
    select: { orderName: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.CustomerSelect;

export function customerBusinessNames(customer: CustomerBusinessProfile | null | undefined): string[] {
  return dedupeOrderNameAliases([customer?.orderName, ...(customer?.orderNames || []).map(row => row.orderName)])
    .map(row => row.orderName);
}

// A single registered alias is a business value; the joined label is display-only.
export function customerOrderName(customer: CustomerBusinessProfile, previous?: string | null): string {
  const names = customerBusinessNames(customer);
  return names.find(name => normalizeOrderIdentifier(name) === normalizeOrderIdentifier(previous))
    || names[0] || String(customer.mark || '').trim();
}

export function customerBusinessLabel(customer: CustomerBusinessProfile | null | undefined, fallback = '-'): string {
  if (!customer) return fallback.toUpperCase();
  return (customerBusinessNames(customer).join(' / ') || String(customer.mark || '').trim() || '-').toUpperCase();
}
