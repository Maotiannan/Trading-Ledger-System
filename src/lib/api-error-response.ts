import { NextResponse } from 'next/server';
import { type ApiErrorCode, apiErrorCodes, isApiError } from '@/lib/api-error';

export function createApiErrorResponse(config: {
  code: ApiErrorCode;
  status: number;
  message: string;
  detail?: unknown;
}): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: config.message,
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

  return createApiErrorResponse({ code, status, message, detail });
}

export function toApiErrorResponse(
  error: unknown,
  fallback: {
    code?: ApiErrorCode;
    status?: number;
    message?: string;
    detail?: unknown;
  } = {}
): NextResponse {
  if (isApiError(error)) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        detail: error.detail ?? null,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      success: false,
      error: fallback.message || '服务器错误',
      code: fallback.code || 'INTERNAL_ERROR',
      detail: fallback.detail ?? null,
    },
    { status: fallback.status ?? 500 }
  );
}
