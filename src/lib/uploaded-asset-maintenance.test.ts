import { db } from '@/lib/db';
import {
  getUploadedAssetCleanupSettings,
  invalidateSystemSettingsCache,
} from '@/lib/system-settings';

jest.mock('@/lib/db', () => ({
  db: {
    systemSetting: {
      findMany: jest.fn(),
    },
  },
}));

const mockFindMany = db.systemSetting.findMany as jest.Mock;

describe('uploaded-asset-maintenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateSystemSettingsCache();
    mockFindMany.mockResolvedValue([]);
  });

  it('returns uploaded asset cleanup ttl defaults', async () => {
    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });
});
