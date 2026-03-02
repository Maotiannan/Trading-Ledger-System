export type UiLocale = 'zh' | 'en';

export type UiTextGetter = (zh: string, en: string) => string;

export function createUiTextGetter(locale: string): UiTextGetter {
  const normalized: UiLocale = locale === 'en' ? 'en' : 'zh';
  return (zh: string, en: string) => (normalized === 'en' ? en : zh);
}
