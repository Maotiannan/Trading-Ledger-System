import { db } from '@/lib/db';
import {
  editableSystemSettingKeys,
  getNumericSystemSetting,
  getSystemSettings,
  integerSystemSettingKeys,
  invalidateSystemSettingsCache,
  numericSystemSettingMaximums,
  numericSystemSettingMinimums,
  systemSettingDefaults,
} from '@/lib/system-settings';

jest.mock('@/lib/db', () => ({
  db: {
    systemSetting: {
      findMany: jest.fn(),
    },
  },
}));

const mockFindMany = db.systemSetting.findMany as jest.Mock;

describe('system-settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateSystemSettingsCache();
  });

  it('merges missing keys into a warm cache instead of falling back to defaults', async () => {
    mockFindMany
      .mockResolvedValueOnce([{ key: 'SWIFT_WARNING_TOLERANCE', value: '2' }])
      .mockResolvedValueOnce([{ key: 'SWIFT_REJECT_TOLERANCE', value: '4' }]);

    await expect(getNumericSystemSetting('SWIFT_WARNING_TOLERANCE', 5)).resolves.toBe(2);
    await expect(getNumericSystemSetting('SWIFT_REJECT_TOLERANCE', 50)).resolves.toBe(4);

    expect(mockFindMany).toHaveBeenNthCalledWith(1, {
      where: { key: { in: ['SWIFT_WARNING_TOLERANCE'] } },
      select: { key: true, value: true },
    });
    expect(mockFindMany).toHaveBeenNthCalledWith(2, {
      where: { key: { in: ['SWIFT_REJECT_TOLERANCE'] } },
      select: { key: true, value: true },
    });
  });

  it('reuses cached values when requested keys are already present', async () => {
    mockFindMany.mockResolvedValueOnce([
      { key: 'SWIFT_WARNING_TOLERANCE', value: '3' },
      { key: 'SWIFT_REJECT_TOLERANCE', value: '7' },
    ]);

    const first = await getSystemSettings(['SWIFT_WARNING_TOLERANCE', 'SWIFT_REJECT_TOLERANCE']);
    const second = await getSystemSettings(['SWIFT_REJECT_TOLERANCE']);

    expect(first).toEqual({
      SWIFT_WARNING_TOLERANCE: '3',
      SWIFT_REJECT_TOLERANCE: '7',
    });
    expect(second).toEqual({
      SWIFT_REJECT_TOLERANCE: '7',
    });
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('exposes Excel lookup rate-limit settings with defaults', () => {
    expect(editableSystemSettingKeys).toEqual(expect.arrayContaining([
      'EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS',
      'EXCEL_LOOKUP_RATE_LIMIT_MAX',
    ]));
    expect(systemSettingDefaults.EXCEL_LOOKUP_RATE_LIMIT_WINDOW_MS).toBe('60000');
    expect(systemSettingDefaults.EXCEL_LOOKUP_RATE_LIMIT_MAX).toBe('240');
  });

  it('exposes customer analytics settings with approved defaults', () => {
    const analyticsKeys = [
      'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
      'CUSTOMER_ANALYTICS_NORMAL_DAYS',
      'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
      'CUSTOMER_ANALYTICS_DELAY_DAYS',
      'CUSTOMER_ANALYTICS_WARNING_DAYS',
      'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
      'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
    ] as const;

    expect(editableSystemSettingKeys).toEqual(expect.arrayContaining(analyticsKeys));
    expect(integerSystemSettingKeys).toEqual(expect.arrayContaining(analyticsKeys));
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_LOOKBACK_MONTHS).toBe('12');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_NORMAL_DAYS).toBe('30');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_MILD_DELAY_DAYS).toBe('60');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_DELAY_DAYS).toBe('90');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_WARNING_DAYS).toBe('120');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS).toBe('150');
    expect(systemSettingDefaults.CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS).toBe('180');
    expect(numericSystemSettingMinimums.CUSTOMER_ANALYTICS_LOOKBACK_MONTHS).toBe(1);
    expect(numericSystemSettingMaximums.CUSTOMER_ANALYTICS_LOOKBACK_MONTHS).toBe(60);

    for (const key of analyticsKeys.slice(1)) {
      expect(numericSystemSettingMinimums[key]).toBe(1);
      expect(numericSystemSettingMaximums[key]).toBe(3650);
    }
  });

  it('exposes bounded MU Contract synchronization settings', () => {
    const keys = [
      'MU_CONTRACT_SYNC_ENABLED',
      'MU_CONTRACT_SYNC_INTERVAL_SECONDS',
      'MU_CONTRACT_SYNC_BATCH_SIZE',
    ] as const;

    expect(editableSystemSettingKeys).toEqual(expect.arrayContaining(keys));
    expect(systemSettingDefaults.MU_CONTRACT_SYNC_ENABLED).toBe('false');
    expect(systemSettingDefaults.MU_CONTRACT_SYNC_INTERVAL_SECONDS).toBe('30');
    expect(systemSettingDefaults.MU_CONTRACT_SYNC_BATCH_SIZE).toBe('100');
    expect(numericSystemSettingMinimums.MU_CONTRACT_SYNC_INTERVAL_SECONDS).toBe(10);
    expect(numericSystemSettingMaximums.MU_CONTRACT_SYNC_INTERVAL_SECONDS).toBe(3600);
    expect(numericSystemSettingMinimums.MU_CONTRACT_SYNC_BATCH_SIZE).toBe(1);
    expect(numericSystemSettingMaximums.MU_CONTRACT_SYNC_BATCH_SIZE).toBe(500);
  });
});
