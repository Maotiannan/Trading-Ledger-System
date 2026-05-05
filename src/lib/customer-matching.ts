import { db } from '@/lib/db';
import { findCustomerOrderNameMatches } from '@/lib/customer-order-name-service';
import { normalizeOrderIdentifier } from '@/lib/order-name-kernel';

export type CustomerResolveInput = {
  customerMark: string;
  customerOrderName?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  customerOrderNo?: string | null;
  ownerIds?: string[] | null;
};

export type CustomerResolveResult = {
  customerId: string | null;
  customerMark: string;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  needsCustomerFix: boolean;
  matchedBy: 'mark' | 'name' | 'manual' | 'none';
  candidateCount: number;
};

function normalize(value: string | null | undefined): string {
  return (value || '').trim();
}

export function normalizeOrderNameForMatch(value: string | null | undefined): string {
  return normalizeOrderIdentifier(value);
}

export function extractOrderNameFromOrderNo(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  const lastDashIndex = normalized.lastIndexOf('-');
  if (lastDashIndex <= 0 || lastDashIndex >= normalized.length - 1) return null;
  const left = normalized.slice(0, lastDashIndex).trim().replace(/\s+/g, ' ');
  return left || null;
}

export async function resolveCustomer(input: CustomerResolveInput): Promise<CustomerResolveResult> {
  const customerMark = normalize(input.customerMark);
  const explicitOrderNameInput = normalize(input.customerOrderName ?? input.customerName);
  const derivedOrderNameInput = extractOrderNameFromOrderNo(input.customerOrderNo);
  const customerOrderNameInput = explicitOrderNameInput || normalize(derivedOrderNameInput);
  const customerIdInput = normalize(input.customerId);
  const baseWhere = Array.isArray(input.ownerIds) && input.ownerIds.length > 0
    ? { ownerId: { in: input.ownerIds } }
    : {};

  const markCandidates = customerMark
    ? await db.customer.findMany({
        where: {
          ...baseWhere,
          normalizedMark: {
            equals: normalizeOrderIdentifier(customerMark),
          },
        },
        select: {
          id: true,
          mark: true,
          orderName: true,
          phone: true,
          city: true,
          orderNames: {
            select: {
              orderName: true,
              normalizedOrderName: true,
            },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      })
    : [];

  if (markCandidates.length === 1) {
    const customer = markCandidates[0];
    const normalizedRequestedOrderName = normalizeOrderIdentifier(customerOrderNameInput);
    const matchedOrderName = customer.orderNames.find((row) => row.normalizedOrderName === normalizedRequestedOrderName)?.orderName
      || customer.orderName;
    return {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: matchedOrderName,
      customerPhone: customer.phone,
      customerCity: customer.city,
      needsCustomerFix: false,
      matchedBy: 'mark',
      candidateCount: 1,
    };
  }

  if (markCandidates.length > 1 && customerIdInput) {
    const selected = markCandidates.find((row) => row.id === customerIdInput);
    if (selected) {
      return {
        customerId: selected.id,
        customerMark: selected.mark,
        customerName: selected.orderName,
        customerPhone: selected.phone,
        customerCity: selected.city,
        needsCustomerFix: false,
        matchedBy: 'manual',
        candidateCount: markCandidates.length,
      };
    }
  }

  if (customerOrderNameInput) {
    const nameCandidates = await findCustomerOrderNameMatches(
      Array.isArray(input.ownerIds) && input.ownerIds.length > 0 ? input.ownerIds : null,
      customerOrderNameInput,
    );

    if (nameCandidates.length === 1) {
      const matchedAlias = nameCandidates[0];
      return {
        customerId: matchedAlias.customer.id,
        customerMark: matchedAlias.customer.mark,
        customerName: matchedAlias.orderName,
        customerPhone: matchedAlias.customer.phone,
        customerCity: matchedAlias.customer.city,
        needsCustomerFix: false,
        matchedBy: 'name',
        candidateCount: markCandidates.length,
      };
    }
  }

  return {
    customerId: null,
    customerMark,
    customerName: customerOrderNameInput || null,
    customerPhone: null,
    customerCity: null,
    needsCustomerFix: true,
    matchedBy: 'none',
    candidateCount: markCandidates.length,
  };
}
