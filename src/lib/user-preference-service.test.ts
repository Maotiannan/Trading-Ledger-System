import { db } from '@/lib/db';
import type { CurrentUser } from '@/lib/request-auth';
import {
  DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE,
  getUserImageCompressionPreference,
  updateUserImageCompressionPreference,
} from '@/lib/user-preference-service';

jest.mock('@/lib/db', () => ({
  db: {
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  userPreference: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};

function makeCurrentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'user-1',
    email: 'user-1@example.com',
    name: 'User 1',
    role: 'USER' as CurrentUser['role'],
    level: 4,
    parentId: null,
    createdById: null,
    ...overrides,
  };
}

describe('user-preference-service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns default image compression preferences when user has no row', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

    const result = await getUserImageCompressionPreference(makeCurrentUser());

    expect(mockDb.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(result).toEqual(DEFAULT_USER_IMAGE_COMPRESSION_PREFERENCE);
  });

  it('updates only the current user preference row', async () => {
    mockDb.userPreference.upsert.mockResolvedValueOnce({
      userId: 'user-1',
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.45',
      ocrTargetMaxKb: 640,
      createdAt: new Date('2026-05-04T10:00:00.000Z'),
      updatedAt: new Date('2026-05-04T10:00:00.000Z'),
    });

    const result = await updateUserImageCompressionPreference(makeCurrentUser(), {
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: 0.45,
      ocrTargetMaxKb: 640,
    });

    expect(mockDb.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
      update: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    });
    expect(result).toEqual({
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: 0.45,
      ocrTargetMaxKb: 640,
    });
  });

  it('rejects image compression quality floor below minimum', async () => {
    await expect(updateUserImageCompressionPreference(makeCurrentUser(), {
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.29,
      ocrTargetMaxKb: 500,
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '图片压缩质量下限不能低于 0.30',
    });

    expect(mockDb.userPreference.upsert).not.toHaveBeenCalled();
  });
});
