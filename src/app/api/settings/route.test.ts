import { apiErrorCodes } from '@/lib/api-error';

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

jest.mock('@/lib/db', () => ({
  db: {
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
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
  getCurrentUserPreferences: jest.fn(),
  getCurrentUserImageCompressionPreferences: jest.fn(),
}));

jest.mock('@/lib/settings-write-service', () => {
  const actual = jest.requireActual('@/lib/settings-write-service');
  return {
    ...actual,
    purgeBranchBusinessData: jest.fn(),
    purgeBusinessData: jest.fn(),
    testSettingsOcr: jest.fn(),
    updateSystemSettings: jest.fn(),
  };
});

import { GET, POST } from '@/app/api/settings/route';
import { db } from '@/lib/db';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/lib/dashboard-layout-preference';
import { DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE } from '@/lib/list-page-size-preference';
import { getCurrentUserPreferences } from '@/lib/settings-read-service';

const mockDb = db as unknown as {
  userPreference: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
};
const mockGetCurrentUserPreferences = getCurrentUserPreferences as jest.Mock;

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
    mockGetCurrentUserPreferences.mockResolvedValueOnce({
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.3,
      ocrTargetMaxKb: 500,
      dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
    });

    const response = await GET({
      nextUrl: new URL('http://localhost/api/settings?view=user-preferences'),
      headers: { get: () => null },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetCurrentUserPreferences).toHaveBeenCalledWith(expect.objectContaining({
      id: 'user-1',
    }));
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.3,
      ocrTargetMaxKb: 500,
      dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
    });
  });

  it('updates current user preferences for update-user-preferences action', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);
    mockDb.userPreference.upsert.mockResolvedValueOnce({
      userId: 'user-1',
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.45',
      ocrTargetMaxKb: 640,
      dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
      createdAt: new Date('2026-05-04T10:00:00.000Z'),
      updatedAt: new Date('2026-05-04T10:00:00.000Z'),
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
    expect(mockDb.userPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: {
        userId: 'user-1',
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
        dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
        listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
      },
      update: {
        imageCompressionEnabled: false,
        imageCompressionQualityFloor: 0.45,
        ocrTargetMaxKb: 640,
        dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
        listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
      },
    });
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: 0.45,
      ocrTargetMaxKb: 640,
      dashboardLayout: DEFAULT_DASHBOARD_LAYOUT,
      listPageSizes: DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
    });
  });

  it('updates dashboard layout through update-user-preferences action', async () => {
    const nextLayout = {
      sections: [
        { id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: false }] },
      ],
    };
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);
    mockDb.userPreference.upsert.mockResolvedValueOnce({
      userId: 'user-1',
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: '0.30',
      ocrTargetMaxKb: 500,
      dashboardLayout: nextLayout,
      createdAt: new Date('2026-05-04T10:00:00.000Z'),
      updatedAt: new Date('2026-05-04T10:00:00.000Z'),
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
            dashboardLayout: nextLayout,
          },
        });
      },
    } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockDb.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: expect.objectContaining({ dashboardLayout: expect.any(Object) }),
    }));
    expect(json.success).toBe(true);
    expect(json.data.dashboardLayout.sections[0].cards[0]).toEqual({ id: 'invoice-balance', visible: false });
  });

  it('maps invalid preference payloads to BAD_REQUEST through real validation', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

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
            imageCompressionQualityFloor: 0.3,
            ocrTargetMaxKb: 500.5,
          },
        });
      },
    } as never);
    const json = await response.json();

    expect(mockDb.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(mockDb.userPreference.upsert).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(json.code).toBe(apiErrorCodes.BAD_REQUEST);
    expect(json.error).toContain('OCR 目标大小必须为 50-10000 KB 的整数');
  });
});
