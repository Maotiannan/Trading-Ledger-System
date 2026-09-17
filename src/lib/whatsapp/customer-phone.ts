// Customer.PHONE is authoritative. Never infer a country or choose among numbers.
export function normalizeWhatsAppCustomerPhone(value: string | null | undefined): string | null {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  const phone = compact.startsWith('00') ? '+' + compact.slice(2) : compact;
  return /^\+[1-9]\d{1,14}$/.test(phone) ? phone : null;
}
