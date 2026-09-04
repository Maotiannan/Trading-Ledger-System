import { apiErrorCodes, createApiError } from '@/lib/api-error';

const EMAIL_MAX_LENGTH = 320;
const SIMPLE_MAILBOX = /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/u;

export type ParsedNotificationEmail = {
  email: string;
  normalizedEmail: string;
};

function cleanEmail(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().normalize('NFC');
}

export function parseNotificationEmail(value: unknown): ParsedNotificationEmail {
  const email = cleanEmail(value);
  if (!email || email.length > EMAIL_MAX_LENGTH || !SIMPLE_MAILBOX.test(email)) {
    throw createApiError({
      code: apiErrorCodes.VALIDATION_ERROR,
      status: 400,
      message: '邮箱格式不正确',
    });
  }
  return {
    email,
    normalizedEmail: email.toLocaleLowerCase('en-US'),
  };
}

export function parseOptionalNotificationEmail(value: unknown): ParsedNotificationEmail | null {
  return cleanEmail(value) ? parseNotificationEmail(value) : null;
}
