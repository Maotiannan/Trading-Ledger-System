import { db } from '@/lib/db';

export const editableSystemSettingKeys = [
  'OCR_DISABLED',
  'OCR_API_BASE_URL',
  'OCR_API_KEY',
  'OCR_MODEL',
  'OCR_MAX_RETRIES',
  'OCR_TIMEOUT_MS',
  'OCR_RETRY_BASE_DELAY_MS',
  'OCR_INPUT_COST_PER_1K',
  'OCR_OUTPUT_COST_PER_1K',
  'SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS',
  'DETAIL_RECEIPT_MATCH_TOLERANCE',
  'SWIFT_WARNING_TOLERANCE',
  'SWIFT_REJECT_TOLERANCE',
  'SETTINGS_AUDIT_MAX_PAGE_SIZE',
  'SETTINGS_AUDIT_EXPORT_MAX_ROWS',
] as const;

export type EditableSystemSettingKey = (typeof editableSystemSettingKeys)[number];

export const booleanSystemSettingKeys = [
  'OCR_DISABLED',
  'SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS',
] as const satisfies readonly EditableSystemSettingKey[];

export type BooleanSystemSettingKey = (typeof booleanSystemSettingKeys)[number];

export const secretSystemSettingKeys = [
  'OCR_API_KEY',
] as const satisfies readonly EditableSystemSettingKey[];

export type SecretSystemSettingKey = (typeof secretSystemSettingKeys)[number];

export const systemSettingDefaults: Record<EditableSystemSettingKey, string> = {
  OCR_DISABLED: process.env.OCR_DISABLED ?? 'false',
  OCR_API_BASE_URL: process.env.OCR_API_BASE_URL ?? 'https://api.openai.com/v1',
  OCR_API_KEY: process.env.OCR_API_KEY ?? '',
  OCR_MODEL: process.env.OCR_MODEL ?? 'gpt-4o-mini',
  OCR_MAX_RETRIES: process.env.OCR_MAX_RETRIES ?? '3',
  OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS ?? '60000',
  OCR_RETRY_BASE_DELAY_MS: process.env.OCR_RETRY_BASE_DELAY_MS ?? '1200',
  OCR_INPUT_COST_PER_1K: process.env.OCR_INPUT_COST_PER_1K ?? '0',
  OCR_OUTPUT_COST_PER_1K: process.env.OCR_OUTPUT_COST_PER_1K ?? '0',
  SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: process.env.SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS ?? 'false',
  DETAIL_RECEIPT_MATCH_TOLERANCE: process.env.DETAIL_RECEIPT_MATCH_TOLERANCE ?? '5',
  SWIFT_WARNING_TOLERANCE: process.env.SWIFT_WARNING_TOLERANCE ?? '5',
  SWIFT_REJECT_TOLERANCE: process.env.SWIFT_REJECT_TOLERANCE ?? '50',
  SETTINGS_AUDIT_MAX_PAGE_SIZE: process.env.SETTINGS_AUDIT_MAX_PAGE_SIZE ?? '100',
  SETTINGS_AUDIT_EXPORT_MAX_ROWS: process.env.SETTINGS_AUDIT_EXPORT_MAX_ROWS ?? '5000',
};

export const numericSystemSettingMinimums: Partial<Record<EditableSystemSettingKey, number>> = {
  OCR_MAX_RETRIES: 0,
  OCR_TIMEOUT_MS: 1,
  OCR_RETRY_BASE_DELAY_MS: 0,
  OCR_INPUT_COST_PER_1K: 0,
  OCR_OUTPUT_COST_PER_1K: 0,
  DETAIL_RECEIPT_MATCH_TOLERANCE: 0,
  SWIFT_WARNING_TOLERANCE: 0,
  SWIFT_REJECT_TOLERANCE: 0,
  SETTINGS_AUDIT_MAX_PAGE_SIZE: 1,
  SETTINGS_AUDIT_EXPORT_MAX_ROWS: 1,
};

let cache: { expiresAt: number; values: Record<string, string> } | null = null;
let cacheWarned = false;

function nowMs(): number {
  return Date.now();
}

function canUseCache(): boolean {
  return Boolean(cache && cache.expiresAt > nowMs());
}

export function invalidateSystemSettingsCache(): void {
  cache = null;
}

export async function getSystemSettings(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const cachedValues = canUseCache() ? cache!.values : null;
  const missingKeys = cachedValues
    ? keys.filter((key) => cachedValues[key] === undefined)
    : keys;

  if (missingKeys.length === 0 && cachedValues) {
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = cachedValues[key];
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: missingKeys } },
      select: { key: true, value: true },
    });
    const fetchedValues = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const mergedValues = {
      ...(cachedValues || {}),
      ...fetchedValues,
    };
    cache = { expiresAt: nowMs() + 15_000, values: mergedValues };

    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = mergedValues[key];
      if (value !== undefined) result[key] = value;
    }
    return result;
  } catch (error) {
    if (!cacheWarned) {
      cacheWarned = true;
      console.warn('[system-settings] table unavailable, fallback to environment only', error);
    }
    if (!cachedValues) return {};
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = cachedValues[key];
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
}

export async function getSystemSettingsWithDefaults<K extends EditableSystemSettingKey>(
  keys: readonly K[]
): Promise<Record<K, string>> {
  const overrides = await getSystemSettings([...keys]);
  return Object.fromEntries(
    keys.map((key) => [key, overrides[key] ?? systemSettingDefaults[key] ?? ''])
  ) as Record<K, string>;
}

export async function getNumericSystemSetting(
  key: EditableSystemSettingKey,
  fallback: number,
  options: { min?: number } = {}
): Promise<number> {
  const settings = await getSystemSettingsWithDefaults([key]);
  const parsed = Number(settings[key]);
  if (!Number.isFinite(parsed)) return fallback;
  if (options.min !== undefined && parsed < options.min) return fallback;
  return parsed;
}
