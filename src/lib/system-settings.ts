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
] as const;

export type EditableSystemSettingKey = (typeof editableSystemSettingKeys)[number];

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
  if (canUseCache()) {
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value = cache!.values[key];
      if (value !== undefined) result[key] = value;
    }
    return result;
  }

  try {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    cache = { expiresAt: nowMs() + 15_000, values };
    return values;
  } catch (error) {
    if (!cacheWarned) {
      cacheWarned = true;
      console.warn('[system-settings] table unavailable, fallback to environment only', error);
    }
    return {};
  }
}
