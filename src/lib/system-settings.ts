import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { DEFAULT_EMAIL_SETTINGS } from '@/lib/email/email-types';

export const customerAnalyticsSystemSettingKeys = [
  'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
  'CUSTOMER_ANALYTICS_NORMAL_DAYS',
  'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
  'CUSTOMER_ANALYTICS_DELAY_DAYS',
  'CUSTOMER_ANALYTICS_WARNING_DAYS',
  'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
  'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
] as const;

export const muContractSyncSettingKeys = [
  'MU_CONTRACT_SYNC_ENABLED',
  'MU_CONTRACT_SYNC_INTERVAL_SECONDS',
  'MU_CONTRACT_SYNC_BATCH_SIZE',
] as const;

export const emailSystemSettingKeys = [
  'email.outboundEnabled',
  'email.recipientMode',
  'email.senderName',
  'email.senderAddress',
  'email.replyToAddress',
  'email.retryLimit',
  'email.retryIntervalsSeconds',
  'email.testModeEnabled',
  'email.testDestination',
  'email.logoUrl',
] as const;

export type EmailSystemSettingKey = (typeof emailSystemSettingKeys)[number];

export const emailSystemSettingDefaults: Record<EmailSystemSettingKey, string> = {
  'email.outboundEnabled': String(DEFAULT_EMAIL_SETTINGS.outboundEnabled),
  'email.recipientMode': DEFAULT_EMAIL_SETTINGS.recipientMode,
  'email.senderName': DEFAULT_EMAIL_SETTINGS.senderName,
  'email.senderAddress': DEFAULT_EMAIL_SETTINGS.senderAddress,
  'email.replyToAddress': DEFAULT_EMAIL_SETTINGS.replyToAddress,
  'email.retryLimit': String(DEFAULT_EMAIL_SETTINGS.retryLimit),
  'email.retryIntervalsSeconds': JSON.stringify(DEFAULT_EMAIL_SETTINGS.retryIntervalsSeconds),
  'email.testModeEnabled': String(DEFAULT_EMAIL_SETTINGS.testModeEnabled),
  'email.testDestination': DEFAULT_EMAIL_SETTINGS.testDestination,
  'email.logoUrl': DEFAULT_EMAIL_SETTINGS.logoUrl,
};

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
  'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
  'AUTH_LOGIN_RATE_LIMIT_MAX',
  'UPLOAD_ACTION_RATE_LIMIT_WINDOW_MS',
  'UPLOAD_ACTION_RATE_LIMIT_MAX',
  'DELETION_ACTION_RATE_LIMIT_WINDOW_MS',
  'DELETION_ACTION_RATE_LIMIT_MAX',
  'EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS',
  'EXCEL_LOOKUP_RATE_LIMIT_MAX',
  'UPLOADED_ASSET_STAGED_TTL_HOURS',
  'SIGNING_PENDING_TTL_HOURS',
  'SETTINGS_AUDIT_MAX_PAGE_SIZE',
  'SETTINGS_AUDIT_EXPORT_MAX_ROWS',
  'ORDER_TRACKER_STATUS_OPTIONS',
  ...customerAnalyticsSystemSettingKeys,
  ...muContractSyncSettingKeys,
] as const;

export type EditableSystemSettingKey = (typeof editableSystemSettingKeys)[number];

export const booleanSystemSettingKeys = [
  'OCR_DISABLED',
  'SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS',
  'MU_CONTRACT_SYNC_ENABLED',
] as const satisfies readonly EditableSystemSettingKey[];

export type BooleanSystemSettingKey = (typeof booleanSystemSettingKeys)[number];

export const secretSystemSettingKeys = [
  'OCR_API_KEY',
] as const satisfies readonly EditableSystemSettingKey[];

export type SecretSystemSettingKey = (typeof secretSystemSettingKeys)[number];

export const integerSystemSettingKeys = [
  ...customerAnalyticsSystemSettingKeys,
  'MU_CONTRACT_SYNC_INTERVAL_SECONDS',
  'MU_CONTRACT_SYNC_BATCH_SIZE',
] as const satisfies readonly EditableSystemSettingKey[];

export type IntegerSystemSettingKey = (typeof integerSystemSettingKeys)[number];

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
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS ?? '60000',
  AUTH_LOGIN_RATE_LIMIT_MAX: process.env.AUTH_LOGIN_RATE_LIMIT_MAX ?? '20',
  UPLOAD_ACTION_RATE_LIMIT_WINDOW_MS: process.env.UPLOAD_ACTION_RATE_LIMIT_WINDOW_MS ?? '60000',
  UPLOAD_ACTION_RATE_LIMIT_MAX: process.env.UPLOAD_ACTION_RATE_LIMIT_MAX ?? '20',
  DELETION_ACTION_RATE_LIMIT_WINDOW_MS: process.env.DELETION_ACTION_RATE_LIMIT_WINDOW_MS ?? '60000',
  DELETION_ACTION_RATE_LIMIT_MAX: process.env.DELETION_ACTION_RATE_LIMIT_MAX ?? '20',
  EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS: process.env.EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS ?? '60000',
  EXCEL_LOOKUP_RATE_LIMIT_MAX: process.env.EXCEL_LOOKUP_RATE_LIMIT_MAX ?? '240',
  UPLOADED_ASSET_STAGED_TTL_HOURS: process.env.UPLOADED_ASSET_STAGED_TTL_HOURS ?? '24',
  SIGNING_PENDING_TTL_HOURS: process.env.SIGNING_PENDING_TTL_HOURS ?? '72',
  SETTINGS_AUDIT_MAX_PAGE_SIZE: process.env.SETTINGS_AUDIT_MAX_PAGE_SIZE ?? '100',
  SETTINGS_AUDIT_EXPORT_MAX_ROWS: process.env.SETTINGS_AUDIT_EXPORT_MAX_ROWS ?? '5000',
  ORDER_TRACKER_STATUS_OPTIONS: process.env.ORDER_TRACKER_STATUS_OPTIONS ?? 'In progress,Confirmed,Canceled',
  CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: process.env.CUSTOMER_ANALYTICS_LOOKBACK_MONTHS ?? '12',
  CUSTOMER_ANALYTICS_NORMAL_DAYS: process.env.CUSTOMER_ANALYTICS_NORMAL_DAYS ?? '30',
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: process.env.CUSTOMER_ANALYTICS_MILD_DELAY_DAYS ?? '60',
  CUSTOMER_ANALYTICS_DELAY_DAYS: process.env.CUSTOMER_ANALYTICS_DELAY_DAYS ?? '90',
  CUSTOMER_ANALYTICS_WARNING_DAYS: process.env.CUSTOMER_ANALYTICS_WARNING_DAYS ?? '120',
  CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: process.env.CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS ?? '150',
  CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: process.env.CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS ?? '180',
  MU_CONTRACT_SYNC_ENABLED: 'false',
  MU_CONTRACT_SYNC_INTERVAL_SECONDS: '30',
  MU_CONTRACT_SYNC_BATCH_SIZE: '100',
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
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: 1000,
  AUTH_LOGIN_RATE_LIMIT_MAX: 1,
  UPLOAD_ACTION_RATE_LIMIT_WINDOW_MS: 1000,
  UPLOAD_ACTION_RATE_LIMIT_MAX: 1,
  DELETION_ACTION_RATE_LIMIT_WINDOW_MS: 1000,
  DELETION_ACTION_RATE_LIMIT_MAX: 1,
  EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS: 1000,
  EXCEL_LOOKUP_RATE_LIMIT_MAX: 1,
  UPLOADED_ASSET_STAGED_TTL_HOURS: 1,
  SIGNING_PENDING_TTL_HOURS: 24,
  SETTINGS_AUDIT_MAX_PAGE_SIZE: 1,
  SETTINGS_AUDIT_EXPORT_MAX_ROWS: 1,
  CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: 1,
  CUSTOMER_ANALYTICS_NORMAL_DAYS: 1,
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: 1,
  CUSTOMER_ANALYTICS_DELAY_DAYS: 1,
  CUSTOMER_ANALYTICS_WARNING_DAYS: 1,
  CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: 1,
  CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: 1,
  MU_CONTRACT_SYNC_INTERVAL_SECONDS: 10,
  MU_CONTRACT_SYNC_BATCH_SIZE: 1,
};

export const numericSystemSettingMaximums: Partial<Record<EditableSystemSettingKey, number>> = {
  CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: 60,
  CUSTOMER_ANALYTICS_NORMAL_DAYS: 3650,
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: 3650,
  CUSTOMER_ANALYTICS_DELAY_DAYS: 3650,
  CUSTOMER_ANALYTICS_WARNING_DAYS: 3650,
  CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: 3650,
  CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: 3650,
  MU_CONTRACT_SYNC_INTERVAL_SECONDS: 3600,
  MU_CONTRACT_SYNC_BATCH_SIZE: 500,
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
      logger.warn('System settings table unavailable, fallback to environment only', error);
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

export async function getUploadedAssetCleanupSettings(): Promise<{
  stagedTtlHours: number;
  signingPendingTtlHours: number;
}> {
  const stagedKey = 'UPLOADED_ASSET_STAGED_TTL_HOURS';
  const signingPendingKey = 'SIGNING_PENDING_TTL_HOURS';
  const [stagedTtlHours, signingPendingTtlHours] = await Promise.all([
    getNumericSystemSetting(
      stagedKey,
      Number(systemSettingDefaults[stagedKey]),
      { min: numericSystemSettingMinimums[stagedKey] }
    ),
    getNumericSystemSetting(
      signingPendingKey,
      Number(systemSettingDefaults[signingPendingKey]),
      { min: numericSystemSettingMinimums[signingPendingKey] }
    ),
  ]);

  return {
    stagedTtlHours,
    signingPendingTtlHours,
  };
}
