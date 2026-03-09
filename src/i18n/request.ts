import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, getLocaleMessages, isSupportedLocale } from '@/lib/i18n';

export default getRequestConfig(async ({ requestLocale }) => {
  const resolvedLocale = await requestLocale;
  const locale = isSupportedLocale(resolvedLocale) ? resolvedLocale : defaultLocale;
  return {
    locale,
    messages: await getLocaleMessages(locale),
  };
});
