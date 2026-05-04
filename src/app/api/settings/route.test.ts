import { apiErrorCodes } from '@/lib/api-error';
import { createApiError } from '@/lib/api-error';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      async json() {
        return body;
      },
    }),
  },
}));

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => {
    const currentUser = {
      id: 'user-1',
      email: 'user-1@example.com',
      name: 'User 1',
      role: 'USER',
      level: 4,
      parentId: null,
      createdById: null,
    };
    return (request: Request) => handler(request, currentUser);
  },
}));

jest.mock('@/lib/settings-read-service', () => ({
  listAllSystemSettingsAuditLogs: jest.fn(),
  listSettings: jest.fn(),
  listSystemSettingsAuditExportLogs: jest.fn(),
  listSystemSettingsAuditLogs: jest.fn(),
  getCurrentUserImageCompressionPreferences: jest.fn(),
}));

jest.mock('@/lib/settings-write-service', () => ({
  purgeBranchBusinessData: jest.fn(),
  purgeBusinessData: jest.fn(),
  testSettingsOcr: jest.fn(),
  updateSystemSettings: jest.fn(),
  updateCurrentUserImageCompressionPreferences: jest.fn(),
}));

import { GET, POST } from '@/app/api/settings/route';
import { getCurrentUserImageCompressionPreferences } from '@/lib/settings-read-service';
import { updateCurrentUserImageCompressionPreferences } from '@/lib/settings-write-service';

const mockGetCurrentUserImageCompressionPreferences = getCurrentUserImageCompressionPreferences as jest.Mock;
const mockUpdateCurrentUserImageCompressionPreferences = updateCurrentUserImageCompressionPreferences as jest.Mock;

describe('settings route user preferences branch', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns current user preferences for user-preferences view', async () => {
    mockGetCurrentUserImageCompressionPreferences.mockResolvedValueOnce({
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.3,
      ocrTargetMaxKb: 500,
    });

    const response = await GET({
      nextUrl: new URL('http://localhost/api/settings?view=user-preferences'),
      headers: { get: () => null },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetCurrentUserImageCompressionPreferences).toHaveBeenCalledWith(expect.objectContaining({
      id: 'user-1',
    }));
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.3,
      ocrTargetMaxKb: 500,
    });
  });

  it('updates current user preferences for update-user-preferences action', async () => {
    mockUpdateCurrentUserImageCompressionPreferences.mockResolvedValueOnce({
      message: '用户偏好已更新',
      preferences: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    });

    const response = await POST({
      headers: {
        get(name: string) {
          return name === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify({
          action: 'update-user-preferences',
          preferences: {
            imageCompressionEnabled: false,
            imageCompressionQualityFloor: 0.45,
            ocrTargetMaxKb: 640,
          },
        });
      },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdateCurrentUserImageCompressionPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
      },
    );
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: 0.45,
      ocrTargetMaxKb: 640,
    });
  });

  it('maps invalid preference payloads to BAD_REQUEST', async () => {
    mockUpdateCurrentUserImageCompressionPreferences.mockRejectedValueOnce(createApiError({
      code: 'BAD_REQUEST',
      status: 400,
      message: '图片压缩质量下限不能低于 0.30',
      detail: { imageCompressionQualityFloor: 0.29 },
    }));

    const response = await POST({
      headers: {
        get(name: string) {
          return name === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return JSON.stringify({
          action: 'update-user-preferences',
          preferences: {
            imageCompressionEnabled: true,
            imageCompressionQualityFloor: 0.29,
            ocrTargetMaxKb: 500,
          },
        });
      },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.code).toBe(apiErrorCodes.BAD_REQUEST);
    expect(json.error).toContain('图片压缩质量下限不能低于 0.30');
  });
});
