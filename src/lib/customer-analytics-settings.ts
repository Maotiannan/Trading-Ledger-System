import type { CustomerAnalyticsSettings } from '@/lib/customer-analytics-types';
import { logger } from '@/lib/logger';
import {
  customerAnalyticsSystemSettingKeys,
  getSystemSettingsWithDefaults,
} from '@/lib/system-settings';

type CustomerAnalyticsStoredSettings = Record<
  (typeof customerAnalyticsSystemSettingKeys)[number],
  string
>;

export const DEFAULT_CUSTOMER_ANALYTICS_SETTINGS: CustomerAnalyticsSettings = Object.freeze({
  lookbackMonths: 12,
  normalDays: 30,
  mildDelayDays: 60,
  delayDays: 90,
  warningDays: 120,
  doubleWarningDays: 150,
  severeWarningDays: 180,
});

function parseBoundedInteger(value: string, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export function parseCustomerAnalyticsSettings(
  stored: Record<string, string>,
): CustomerAnalyticsSettings | null {
  const settings: CustomerAnalyticsSettings = {
    lookbackMonths: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_LOOKBACK_MONTHS, 1, 60) ?? Number.NaN,
    normalDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_NORMAL_DAYS, 1, 3650) ?? Number.NaN,
    mildDelayDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_MILD_DELAY_DAYS, 1, 3650) ?? Number.NaN,
    delayDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_DELAY_DAYS, 1, 3650) ?? Number.NaN,
    warningDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_WARNING_DAYS, 1, 3650) ?? Number.NaN,
    doubleWarningDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS, 1, 3650) ?? Number.NaN,
    severeWarningDays: parseBoundedInteger(stored.CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS, 1, 3650) ?? Number.NaN,
  };

  const thresholds = [
    settings.normalDays,
    settings.mildDelayDays,
    settings.delayDays,
    settings.warningDays,
    settings.doubleWarningDays,
    settings.severeWarningDays,
  ];
  const validThresholds = thresholds.every((value, index) => (
    Number.isInteger(value) && (index === 0 || thresholds[index - 1] < value)
  ));

  if (!Number.isInteger(settings.lookbackMonths) || !validThresholds) return null;
  return settings;
}

export async function getCustomerAnalyticsSettings(): Promise<CustomerAnalyticsSettings> {
  const stored = await getSystemSettingsWithDefaults(
    customerAnalyticsSystemSettingKeys,
  ) as CustomerAnalyticsStoredSettings;
  const parsed = parseCustomerAnalyticsSettings(stored);
  if (parsed) return parsed;

  logger.warn('Invalid customer analytics settings; using defaults', { stored });
  return DEFAULT_CUSTOMER_ANALYTICS_SETTINGS;
}
