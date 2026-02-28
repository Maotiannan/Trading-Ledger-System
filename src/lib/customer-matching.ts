import { db } from '@/lib/db';

export type CustomerResolveInput = {
  customerMark: string;
  customerOrderName?: string | null;
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
  const customerOrderNameInput = normalize(input.customerOrderName ?? input.customerName);
  const customerIdInput = normalize(input.customerId);

  const markCandidates = customerMark
    ? await db.customer.findMany({
        where: {
          mark: {
            equals: customerMark,
            mode: 'insensitive',
          },
        },
        select: { id: true, mark: true, orderName: true, phone: true, city: true },
      })
    : [];

  if (markCandidates.length === 1) {
    const customer = markCandidates[0];
    return {
      customerId: customer.id,
      customerMark: customer.mark,
      customerName: customer.orderName,
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
    const nameCandidates = await db.customer.findMany({
      where: {
        orderName: {
          equals: customerOrderNameInput,
          mode: 'insensitive',
        },
      },
      select: { id: true, mark: true, orderName: true, phone: true, city: true },
    });

    if (nameCandidates.length === 1) {
      const customer = nameCandidates[0];
      return {
        customerId: customer.id,
        customerMark: customer.mark,
        customerName: customer.orderName,
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
    customerName: customerOrderNameInput || null,
    customerPhone: null,
    customerCity: null,
    needsCustomerFix: true,
    matchedBy: 'none',
    candidateCount: markCandidates.length,
  };
}
