import type { NextRequest } from 'next/server';
import { defaultLocale, isSupportedLocale, type SupportedLocale } from '@/lib/i18n';

export type RequestLike = Request | NextRequest | {
  headers?: Headers | { get(name: string): string | null | undefined };
  cookies?: { get(name: string): { value?: string | null } | undefined };
} | null | undefined;

function readCookieFromHeader(cookieHeader: string, key: string): string | null {
  const cookies = cookieHeader.split(';');
  for (const row of cookies) {
    const [name, ...rest] = row.split('=');
    if (name?.trim() !== key) continue;
    return decodeURIComponent(rest.join('=').trim());
  }
  return null;
}

export function resolveRequestLocale(request?: RequestLike): SupportedLocale {
  const cookieStore = request && typeof request === 'object' && 'cookies' in request
    ? request.cookies
    : undefined;
  const cookieLocale = cookieStore?.get?.('NEXT_LOCALE')?.value
    || readCookieFromHeader(request?.headers?.get?.('cookie') || '', 'NEXT_LOCALE');
  if (isSupportedLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = request?.headers?.get?.('accept-language') || '';
  const firstToken = acceptLanguage.split(',')[0]?.trim().slice(0, 2);
  if (isSupportedLocale(firstToken)) return firstToken;
  return defaultLocale;
}
