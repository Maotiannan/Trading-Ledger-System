const GROUP_SEPARATOR = '/';

export function normalizeOrderNo(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function compareOrderPart(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}

export function splitCompositeOrderNo(orderNo: string | null | undefined): string[] {
  if (!orderNo) return [];
  return orderNo
    .split(GROUP_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function canonicalizeOrderNo(orderNo: string | null | undefined): string {
  const parts = splitCompositeOrderNo(orderNo);
  if (parts.length <= 1) {
    return (orderNo || '').trim();
  }

  const byNormalized = new Map<string, string>();
  for (const part of parts) {
    const normalized = normalizeOrderNo(part);
    if (!normalized) continue;
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, part);
    }
  }

  return Array.from(byNormalized.entries())
    .sort((a, b) => compareOrderPart(a[0], b[0]))
    .map(([, original]) => original)
    .join(GROUP_SEPARATOR);
}

export function extractAliasOrderNos(orderNo: string | null | undefined): string[] {
  const canonical = canonicalizeOrderNo(orderNo);
  const parts = splitCompositeOrderNo(canonical);
  if (parts.length <= 1) return [];

  return Array.from(
    new Set(
      parts
        .map((part) => normalizeOrderNo(part))
        .filter(Boolean)
    )
  );
}

export function isCompositeOrderNo(orderNo: string | null | undefined): boolean {
  return splitCompositeOrderNo(orderNo).length > 1;
}

export function buildOrderNoWithAliases(orderNo: string | null | undefined): {
  canonicalOrderNo: string;
  aliasNos: string[];
} {
  const canonicalOrderNo = canonicalizeOrderNo(orderNo);
  const aliasNos = extractAliasOrderNos(canonicalOrderNo);
  return { canonicalOrderNo, aliasNos };
}
