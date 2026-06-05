import { NextRequest, NextResponse } from 'next/server';
import { apiErrorCodes } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { parseJsonRequest } from '@/lib/http-body';
import { defaultLocale, isSupportedLocale } from '@/lib/i18n';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
    const locale = typeof body?.locale === 'string' && isSupportedLocale(body.locale)
      ? body.locale
      : defaultLocale;

    const response = NextResponse.json({ success: true });
    response.cookies.set('NEXT_LOCALE', locale, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    logger.error('Locale API error', error);
    return toApiErrorResponse(error, {
      code: apiErrorCodes.INTERNAL_ERROR,
      status: 500,
      message: '设置语言失败',
    }, request);
  }
}
