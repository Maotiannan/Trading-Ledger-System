import { NextRequest, NextResponse } from 'next/server';
import { defaultLocale, isSupportedLocale } from '@/lib/i18n';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
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
    console.error('Locale API error:', error);
    return NextResponse.json({ success: false, error: '设置语言失败' }, { status: 500 });
  }
}
