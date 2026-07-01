export const APP_TIME_ZONE = 'Africa/Conakry';

type DateInput = Date | string | number | null | undefined;

function parseDateInput(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAppDate(value: DateInput, fallback = '-'): string {
  const date = parseDateInput(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatAppDateTime(value: DateInput, fallback = '-'): string {
  const date = parseDateInput(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatAppDateInputValue(value: DateInput): string {
  const date = parseDateInput(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}
