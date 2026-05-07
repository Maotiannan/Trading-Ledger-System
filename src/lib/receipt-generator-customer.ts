function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getReceiptGeneratorCustomerCompanyName(customer: unknown): string | null {
  if (!customer || typeof customer !== 'object' || !('companyName' in customer)) {
    return null;
  }
  const value = (customer as { companyName?: unknown }).companyName;
  return trimString(value) || null;
}

export function getReceiptGeneratorCustomerName(customer: unknown, fallbackName?: string | null): string | null {
  if (customer && typeof customer === 'object' && 'name' in customer) {
    const value = (customer as { name?: unknown }).name;
    const customerName = trimString(value);
    if (customerName) {
      return customerName;
    }
  }

  const fallback = trimString(fallbackName);
  return fallback || null;
}
