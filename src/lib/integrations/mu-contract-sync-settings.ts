import {
  getSystemSettingsWithDefaults,
  muContractSyncSettingKeys,
} from '@/lib/system-settings';

export { muContractSyncSettingKeys };

export type MuContractSyncSettings = {
  enabled: boolean;
  intervalSeconds: number;
  batchSize: number;
};

function boundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export async function getMuContractSyncSettings(): Promise<MuContractSyncSettings> {
  const settings = await getSystemSettingsWithDefaults(muContractSyncSettingKeys);
  return {
    enabled: settings.MU_CONTRACT_SYNC_ENABLED === 'true',
    intervalSeconds: boundedInteger(
      settings.MU_CONTRACT_SYNC_INTERVAL_SECONDS,
      30,
      10,
      3600,
    ),
    batchSize: boundedInteger(settings.MU_CONTRACT_SYNC_BATCH_SIZE, 100, 1, 500),
  };
}
