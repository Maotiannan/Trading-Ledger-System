export type CustomerDisplaySource = {
  companyName?: string | null;
  name?: string | null;
  mark?: string | null;
};

export type CustomerPayerLabelOptions = {
  fallbackToMark?: boolean;
};

function clean(value: string | null | undefined): string {
  return String(value || '').trim();
}

export function getCustomerPayerBase(source: Pick<CustomerDisplaySource, 'companyName' | 'name'>): string | null {
  return clean(source.companyName) || clean(source.name) || null;
}

export function formatCustomerPayerLabel(
  source: CustomerDisplaySource,
  options: CustomerPayerLabelOptions = {}
): string | null {
  const base = getCustomerPayerBase(source);
  const mark = clean(source.mark);
  if (!base) {
    return options.fallbackToMark ? (mark || null) : null;
  }
  return mark ? `${base} "${mark}"` : base;
}
