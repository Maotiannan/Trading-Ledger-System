import {
  translateApiErrorCode as translateApiErrorCodeByLocale,
  translateApiErrorMessage as translateApiErrorMessageByLocale,
} from '@/lib/api-error-catalog';

export function translateApiErrorMessage(raw: string): string {
  return translateApiErrorMessageByLocale(raw, 'en');
}

export function translateApiErrorCode(code?: string | null, fallbackMessage = ''): string {
  return translateApiErrorCodeByLocale(code, fallbackMessage, 'en');
}
