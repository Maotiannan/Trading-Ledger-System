import { NextResponse } from 'next/server';
import { type ApiErrorCode, isApiError } from '@/lib/api-error';

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
