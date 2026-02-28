import { db } from '@/lib/db';

export type CustomerResolveInput = {
  customerMark: string;
  customerName?: string | null;
  customerId?: string | null;
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

export async function resolveCustomer(input: CustomerResolveInput): Promise<CustomerResolveResult> {
  const customerMark = normalize(input.customerMark);
  const customerNameInput = normalize(input.customerName);
  const customerIdInput = normalize(input.customerId);

  const markCandidates = customerMark
    ? await db.customer.findMany({
        where: {
          mark: {
            equals: customerMark,
            mode: 'insensitive',
          },
        },
        select: { id: true, mark: true, name: true, phone: true, city: true },
      })
    : [];

  if (markCandidates.length === 1) {
    const customer = markCandidates[0];
    return {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.name,
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
        customerName: selected.name,
        customerPhone: selected.phone,
        customerCity: selected.city,
        needsCustomerFix: false,
        matchedBy: 'manual',
        candidateCount: markCandidates.length,
      };
    }
  }

  if (customerNameInput) {
    const nameCandidates = await db.customer.findMany({
      where: {
        name: {
          equals: customerNameInput,
          mode: 'insensitive',
        },
      },
      select: { id: true, mark: true, name: true, phone: true, city: true },
    });

    if (nameCandidates.length === 1) {
      const customer = nameCandidates[0];
      return {
        customerId: customer.id,
        customerMark: customer.mark,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerCity: customer.city,
        needsCustomerFix: false,
        matchedBy: 'name',
        candidateCount: markCandidates.length,
      };
    }
  }

  return {
    customerId: null,
    customerMark,
    customerName: customerNameInput || null,
    customerPhone: null,
    customerCity: null,
    needsCustomerFix: true,
    matchedBy: 'none',
    candidateCount: markCandidates.length,
  };
}
