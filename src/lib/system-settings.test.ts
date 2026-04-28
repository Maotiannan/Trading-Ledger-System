import { db } from '@/lib/db';
import {
  editableSystemSettingKeys,
  getNumericSystemSetting,
  getSystemSettings,
  invalidateSystemSettingsCache,
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
});
