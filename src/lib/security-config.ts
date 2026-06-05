const PUBLIC_PLACEHOLDER_VALUES = new Set([
  'replace-with-a-long-random-secret',
  'replace-with-your-secret',
  'replace-secret',
  'changeme',
  'change-me',
  'dev-only-session-secret-change-me-32-chars',
]);

export function isUnsafePlaceholder(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return PUBLIC_PLACEHOLDER_VALUES.has(normalized);
}

export function requireProductionSecret(
  name: string,
  value: string | null | undefined,
  options: { minLength?: number } = {},
): string {
  const secret = String(value || '').trim();
  const minLength = options.minLength ?? 32;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && (secret.length < minLength || isUnsafePlaceholder(secret))) {
    throw new Error(`${name} must be set in production, must not be a public placeholder, and must be at least ${minLength} chars`);
  }

  return secret;
}

export function isUnsafeInitialAdminPassword(value: string | null | undefined): boolean {
  const password = String(value || '');
  return !password || password === '12345678' || password.toLowerCase() === 'password';
}
