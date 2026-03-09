'use client';

import { useCallback } from 'react';
import { useLocale } from 'next-intl';

export function useUiText() {
  const locale = useLocale();
  return useCallback((zh: string, en: string) => (locale === 'en' ? en : zh), [locale]);
}
