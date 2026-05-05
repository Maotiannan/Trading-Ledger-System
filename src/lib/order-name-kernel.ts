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
