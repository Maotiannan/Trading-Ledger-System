export function parseDisplayMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundDisplayMoney(value: unknown): number | null {
  const parsed = parseDisplayMoney(value);
  if (parsed === null) return null;
  return parsed < 0 ? -Math.round(Math.abs(parsed)) : Math.round(parsed);
}

export function formatUsdAmount(value: unknown, empty = '-'): string {
  const rounded = roundDisplayMoney(value);
  if (rounded === null) return empty;
  const abs = Math.abs(rounded).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return rounded < 0 ? `-$${abs}` : `$${abs}`;
}

export function formatMoneyInputValue(value: unknown): string {
  const rounded = roundDisplayMoney(value);
  return rounded === null ? '' : rounded.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function normalizeMoneyInputValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[$,\s]/g, '');
}

export function formatOrderNameDisplay(value: unknown, fallback = '-'): string {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw ? raw.toUpperCase() : fallback;
}
