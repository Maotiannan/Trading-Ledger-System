import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, getLocaleMessages, isSupportedLocale } from '@/lib/i18n';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = isSupportedLocale(requestLocale) ? requestLocale : defaultLocale;
  return {
    locale,
    messages: await getLocaleMessages(locale),
  };
});
