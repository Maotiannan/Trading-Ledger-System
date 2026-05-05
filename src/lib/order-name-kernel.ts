import { canonicalizeOrderNo, normalizeOrderNo, splitCompositeOrderNo } from '@/lib/order-alias';

export function normalizeOrderIdentifier(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function extractOrderNamePrefix(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  const lastDashIndex = normalized.lastIndexOf('-');
  if (lastDashIndex <= 0 || lastDashIndex >= normalized.length - 1) return null;
  const left = normalized.slice(0, lastDashIndex).trim();
  return left || null;
}

export function dedupeOrderNameAliases(values: Array<string | null | undefined>) {
  const results: Array<{ orderName: string; normalizedOrderName: string }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const orderName = String(value || '').trim();
    const normalizedOrderName = normalizeOrderIdentifier(orderName);
    if (!orderName || !normalizedOrderName || seen.has(normalizedOrderName)) continue;
    seen.add(normalizedOrderName);
    results.push({ orderName, normalizedOrderName });
  }
  return results;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(text);
  }
  return results;
}

export function expandCompositeOrderSegments(value: string | null | undefined): string[] {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const canonical = canonicalizeOrderNo(raw);
  return dedupeStrings([
    ...splitCompositeOrderNo(raw),
    ...splitCompositeOrderNo(canonical),
    raw,
    canonical,
  ]);
}

export function buildCompositeOrderLookupCandidates(value: string | null | undefined) {
  const exactOrderNos = expandCompositeOrderSegments(value);
  const normalizedOrderNos = Array.from(new Set(exactOrderNos.map((row) => normalizeOrderNo(row)).filter(Boolean)));
  const segmentCandidates = dedupeStrings([
    ...splitCompositeOrderNo(String(value || '').trim()),
    ...splitCompositeOrderNo(canonicalizeOrderNo(value)),
  ]);
  const orderNameCandidates = dedupeOrderNameAliases(
    segmentCandidates.flatMap((row) => [row, extractOrderNamePrefix(row)]),
  );

  return {
    exactOrderNos,
    normalizedOrderNos,
    orderNameCandidates,
    derivedOrderNames: orderNameCandidates
      .map((row) => row.orderName)
      .filter((row) => exactOrderNos.every((candidate) => candidate !== row)),
  };
}
