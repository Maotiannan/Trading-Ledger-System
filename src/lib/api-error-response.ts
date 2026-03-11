import { NextRequest, NextResponse } from 'next/server';
import { type ApiErrorCode, apiErrorCodes, isApiError } from '@/lib/api-error';
import { defaultLocale, isSupportedLocale, type SupportedLocale } from '@/lib/i18n';
import { translateApiErrorCode, translateApiErrorMessage } from '@/lib/api-error-catalog';

type RequestLike = Request | NextRequest | {
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

function resolveRequestLocale(request?: RequestLike): SupportedLocale {
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

function localizeApiErrorMessage(
  code: ApiErrorCode,
  message: string,
  locale: SupportedLocale,
): string {
  if (message) {
    return translateApiErrorMessage(message, locale);
  }
  return translateApiErrorCode(code, message, locale);
}

export function createApiErrorResponse(config: {
  code: ApiErrorCode;
  status: number;
  message: string;
  detail?: unknown;
}, request?: RequestLike): NextResponse {
  const locale = resolveRequestLocale(request);
  const message = localizeApiErrorMessage(config.code, config.message, locale);
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: config.code,
      detail: config.detail ?? null,
    },
    { status: config.status }
  );
}

export function createApiErrorResponseByStatus(
  status: number,
  message: string,
  detail?: unknown,
  request?: RequestLike,
): NextResponse {
  const code =
    status === 400
      ? apiErrorCodes.BAD_REQUEST
      : status === 401
        ? apiErrorCodes.AUTH_REQUIRED
        : status === 403
          ? apiErrorCodes.FORBIDDEN
          : status === 404
            ? apiErrorCodes.RESOURCE_NOT_FOUND
            : status === 409
              ? apiErrorCodes.CONFLICT
              : apiErrorCodes.INTERNAL_ERROR;

  return createApiErrorResponse({ code, status, message, detail }, request);
}

export function toApiErrorResponse(
  error: unknown,
  fallback: {
    code?: ApiErrorCode;
    status?: number;
    message?: string;
    detail?: unknown;
  } = {},
  request?: RequestLike,
): NextResponse {
  const locale = resolveRequestLocale(request);
  if (isApiError(error)) {
    const message = localizeApiErrorMessage(error.code, error.message, locale);
    return NextResponse.json(
      {
        success: false,
        error: message,
        code: error.code,
        detail: error.detail ?? null,
      },
      { status: error.status }
    );
  }

  const fallbackCode = fallback.code || 'INTERNAL_ERROR';
  const fallbackMessage = fallback.message || '服务器错误';
  return NextResponse.json(
    {
      success: false,
      error: localizeApiErrorMessage(fallbackCode, fallbackMessage, locale),
      code: fallbackCode,
      detail: fallback.detail ?? null,
    },
    { status: fallback.status ?? 500 }
  );
}
