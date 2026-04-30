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

  it('returns uploaded asset cleanup ttl defaults when no overrides exist', async () => {
    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });

  it('honors persisted uploaded asset cleanup ttl overrides', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: '36' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: '96' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(36);
    expect(settings.signingPendingTtlHours).toBe(96);
  });

  it('falls back to defaults when uploaded asset cleanup ttl overrides are below minimums', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: '0' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: '12' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });

  it('falls back to defaults when uploaded asset cleanup ttl overrides are malformed or non-finite', async () => {
    mockFindMany.mockResolvedValue([
      { key: 'UPLOADED_ASSET_STAGED_TTL_HOURS', value: 'Infinity' },
      { key: 'SIGNING_PENDING_TTL_HOURS', value: 'not-a-number' },
    ]);

    const settings = await getUploadedAssetCleanupSettings();

    expect(settings.stagedTtlHours).toBe(24);
    expect(settings.signingPendingTtlHours).toBe(72);
  });
});
