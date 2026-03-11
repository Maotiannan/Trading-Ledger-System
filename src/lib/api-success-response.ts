import { NextResponse } from 'next/server';
import { resolveRequestLocale, type RequestLike } from '@/lib/api-response-locale';
import { translateApiSuccessMessage } from '@/lib/api-success-catalog';

type SuccessPayload = {
  message?: string | null;
  [key: string]: unknown;
};

export function localizeApiSuccessMessage(message: string | null | undefined, request?: RequestLike): string | undefined {
  if (!message) return undefined;
  const locale = resolveRequestLocale(request);
  return translateApiSuccessMessage(message, locale);
}

export function createApiSuccessResponse<T extends SuccessPayload>(
  payload: T,
  request?: RequestLike,
  init?: ResponseInit,
): NextResponse {
  const { message, ...rest } = payload;
  const localizedMessage = localizeApiSuccessMessage(message, request);
  return NextResponse.json(
    {
      success: true,
      ...rest,
      ...(localizedMessage ? { message: localizedMessage } : {}),
    },
    init,
  );
}
