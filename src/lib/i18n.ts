export const supportedLocales = ['zh', 'en'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = 'zh';

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  if (!value) return false;
  return supportedLocales.includes(value as SupportedLocale);
}

export async function getLocaleMessages(locale: SupportedLocale) {
  if (locale === 'en') {
    return (await import('@/messages/en.json')).default;
  }
  return (await import('@/messages/zh.json')).default;
}
