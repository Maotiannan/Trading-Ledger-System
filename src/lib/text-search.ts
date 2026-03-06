function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function valueMatchesSearch(value: unknown, needle: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.toLowerCase().includes(needle);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value).toLowerCase().includes(needle);
  }
  if (value instanceof Date) return value.toISOString().toLowerCase().includes(needle);
  if (Array.isArray(value)) return value.some((item) => valueMatchesSearch(item, needle));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => valueMatchesSearch(item, needle));
  }
  return String(value).toLowerCase().includes(needle);
}

export function filterRowsBySearch<T>(rows: T[], search: string): T[] {
  const needle = normalizeSearchText(search);
  if (!needle) return rows;
  return rows.filter((row) => valueMatchesSearch(row, needle));
}
