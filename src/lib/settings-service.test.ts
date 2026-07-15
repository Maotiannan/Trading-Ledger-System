import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import {
  purgeBranchBusinessData,
  purgeBusinessData,
  testSettingsOcr,
  updateCurrentUserPreferences,
  updateSystemSettings,
} from '@/lib/settings-write-service';
import {
  getCurrentUserPreferences,
  getCurrentUserImageCompressionPreferences,
  listSettings,
  listAllSystemSettingsAuditLogs,
  listSystemSettingsAuditExportLogs,
  listSystemSettingsAuditLogs,
} from '@/lib/settings-read-service';
import { verifyPassword } from '@/lib/auth';
import { testOcrConnectivity } from '@/lib/ocr';
import { recordAuditEvent } from '@/lib/audit';
import {
  getSystemSettingsWithDefaults,
  invalidateSystemSettingsCache,
} from '@/lib/system-settings';

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    userPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    systemSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    detailItem: { deleteMany: jest.fn(), updateMany: jest.fn() },
    receiptHistory: { deleteMany: jest.fn() },
    detailHistory: { deleteMany: jest.fn() },
    balanceTransfer: { deleteMany: jest.fn() },
    swift: { deleteMany: jest.fn(), findMany: jest.fn() },
    receipt: { deleteMany: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    detail: { deleteMany: jest.fn(), findMany: jest.fn() },
    order: { deleteMany: jest.fn(), findMany: jest.fn() },
    invoice: { deleteMany: jest.fn(), findMany: jest.fn() },
    customer: { deleteMany: jest.fn(), findMany: jest.fn() },
    deletionRequest: { deleteMany: jest.fn() },
    auditLog: { deleteMany: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/ocr', () => ({
  testOcrConnectivity: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
  editableSystemSettingKeys: [
    'OCR_DISABLED',
    'OCR_API_KEY',
    'DETAIL_RECEIPT_MATCH_TOLERANCE',
    'SWIFT_WARNING_TOLERANCE',
    'SWIFT_REJECT_TOLERANCE',
    'SETTINGS_AUDIT_MAX_PAGE_SIZE',
    'SETTINGS_AUDIT_EXPORT_MAX_ROWS',
    'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
    'CUSTOMER_ANALYTICS_NORMAL_DAYS',
    'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
  ],
  customerAnalyticsSystemSettingKeys: [
    'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
    'CUSTOMER_ANALYTICS_NORMAL_DAYS',
    'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
  ],
  booleanSystemSettingKeys: ['OCR_DISABLED'],
  secretSystemSettingKeys: ['OCR_API_KEY'],
  numericSystemSettingMinimums: {
    DETAIL_RECEIPT_MATCH_TOLERANCE: 0,
    SWIFT_WARNING_TOLERANCE: 0,
    SWIFT_REJECT_TOLERANCE: 0,
    SETTINGS_AUDIT_MAX_PAGE_SIZE: 1,
    SETTINGS_AUDIT_EXPORT_MAX_ROWS: 1,
    CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: 1,
    CUSTOMER_ANALYTICS_NORMAL_DAYS: 1,
    CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: 1,
    CUSTOMER_ANALYTICS_DELAY_DAYS: 1,
    CUSTOMER_ANALYTICS_WARNING_DAYS: 1,
    CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: 1,
    CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: 1,
  },
  numericSystemSettingMaximums: {
    CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: 60,
    CUSTOMER_ANALYTICS_NORMAL_DAYS: 3650,
    CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: 3650,
    CUSTOMER_ANALYTICS_DELAY_DAYS: 3650,
    CUSTOMER_ANALYTICS_WARNING_DAYS: 3650,
    CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: 3650,
    CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: 3650,
  },
  integerSystemSettingKeys: [
    'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
    'CUSTOMER_ANALYTICS_NORMAL_DAYS',
    'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_DELAY_DAYS',
    'CUSTOMER_ANALYTICS_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
    'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
  ],
  getSystemSettingsWithDefaults: jest.fn(),
  invalidateSystemSettingsCache: jest.fn(),
}));

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  level: number;
  parentId: string | null;
  createdById: string | null;
}> = {}) {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: UserRole.ADMIN,
    level: 1,
    parentId: null,
    createdById: null,
    ...overrides,
  };
}

const mockDb = db as unknown as {
  user: { findMany: jest.Mock; findUnique: jest.Mock };
  userPreference: { findUnique: jest.Mock; upsert: jest.Mock };
  systemSetting: { findMany: jest.Mock; upsert: jest.Mock };
  detailItem: { deleteMany: jest.Mock; updateMany: jest.Mock };
  receiptHistory: { deleteMany: jest.Mock };
  detailHistory: { deleteMany: jest.Mock };
  balanceTransfer: { deleteMany: jest.Mock };
  swift: { deleteMany: jest.Mock; findMany: jest.Mock };
  receipt: { deleteMany: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
  detail: { deleteMany: jest.Mock; findMany: jest.Mock };
  order: { deleteMany: jest.Mock; findMany: jest.Mock };
  invoice: { deleteMany: jest.Mock; findMany: jest.Mock };
  customer: { deleteMany: jest.Mock; findMany: jest.Mock };
  deletionRequest: { deleteMany: jest.Mock };
  auditLog: { deleteMany: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};

const mockGetSystemSettingsWithDefaults = getSystemSettingsWithDefaults as jest.Mock;
const mockInvalidateSystemSettingsCache = invalidateSystemSettingsCache as jest.Mock;
const mockVerifyPassword = verifyPassword as jest.Mock;
const mockTestOcrConnectivity = testOcrConnectivity as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;

const validAnalyticsSettings = {
  CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '18',
  CUSTOMER_ANALYTICS_NORMAL_DAYS: '35',
  CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '65',
  CUSTOMER_ANALYTICS_DELAY_DAYS: '95',
  CUSTOMER_ANALYTICS_WARNING_DAYS: '125',
  CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '155',
  CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '185',
};

describe('settings-service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetSystemSettingsWithDefaults.mockResolvedValue({
      OCR_DISABLED: 'false',
      OCR_API_KEY: 'old-secret',
      DETAIL_RECEIPT_MATCH_TOLERANCE: '5',
      SWIFT_WARNING_TOLERANCE: '5',
      SWIFT_REJECT_TOLERANCE: '50',
      SETTINGS_AUDIT_MAX_PAGE_SIZE: '100',
      SETTINGS_AUDIT_EXPORT_MAX_ROWS: '5000',
      CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12',
      CUSTOMER_ANALYTICS_NORMAL_DAYS: '30',
      CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '60',
      CUSTOMER_ANALYTICS_DELAY_DAYS: '90',
      CUSTOMER_ANALYTICS_WARNING_DAYS: '120',
      CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS: '150',
      CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '180',
    });
  });

  it('lists editable settings and branch purge targets for admin', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      { id: 'sales-1', email: 'sales@example.com', name: 'Sales', level: 3, role: UserRole.SALES, parentId: 'admin-1' },
    ]);

    const result = await listSettings(makeUser());

    expect(result.settings.SWIFT_WARNING_TOLERANCE).toBe('5');
    expect(result.canEdit).toBe(true);
    expect(result.canViewAudit).toBe(true);
    expect(result.canPurgeBranch).toBe(true);
    expect(result.branchPurgeTargets).toHaveLength(1);
    expect(result.auditCapabilities).toEqual({
      defaultPageSize: 20,
      maxPageSize: 100,
      maxExportRows: 5000,
      pageSizeOptions: [20, 50, 100],
      cursorMode: 'id',
    });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_VIEW',
      targetType: 'SYSTEM_SETTING',
      actorId: 'admin-1',
      metadata: expect.objectContaining({
        editableKeyCount: 14,
        branchPurgeTargetCount: 1,
        canEdit: true,
        canViewAudit: true,
      }),
    }));
  });

  it('lists settings for non-admin without privileged capabilities', async () => {
    const salesUser = makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    });

    const result = await listSettings(salesUser);

    expect(result.canEdit).toBe(false);
    expect(result.canViewAudit).toBe(false);
    expect(result.canPurgeBranch).toBe(false);
    expect(result.branchPurgeTargets).toEqual([]);
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_VIEW',
      actorId: 'sales-1',
      metadata: expect.objectContaining({
        branchPurgeTargetCount: 0,
        canEdit: false,
        canViewAudit: false,
      }),
    }));
  });

  it('returns default image compression preferences when the current user has no row', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

    const result = await getCurrentUserImageCompressionPreferences(makeUser({ id: 'user-without-preference' }));

    expect(mockDb.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-without-preference' },
    });
    expect(result).toEqual({
      imageCompressionEnabled: true,
      imageCompressionQualityFloor: 0.3,
      ocrTargetMaxKb: 500,
    });
  });

  it('returns stored image compression preferences for the current user', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce({
      userId: 'user-with-preference',
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.45',
      ocrTargetMaxKb: 768,
    });

    const result = await getCurrentUserImageCompressionPreferences(makeUser({ id: 'user-with-preference' }));

    expect(result).toEqual({
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: 0.45,
      ocrTargetMaxKb: 768,
    });
  });

  it('returns default dashboard layout with image preferences for the current user', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

    const result = await getCurrentUserPreferences(makeUser({ id: 'user-without-dashboard-preference' }));

    expect(result.imageCompressionEnabled).toBe(true);
    expect(result.dashboardLayout.sections.map((section) => section.id)).toEqual(['summary', 'analysis', 'recent']);
    expect(result.dashboardLayout.sections[0].cards.map((card) => card.id)).toContain('invoice-balance');
  });

  it('updates dashboard layout without resetting image compression preferences', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce({
      userId: 'user-with-dashboard-preference',
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.75',
      ocrTargetMaxKb: 800,
      dashboardLayout: null,
    });
    mockDb.userPreference.upsert.mockResolvedValueOnce({
      userId: 'user-with-dashboard-preference',
      imageCompressionEnabled: false,
      imageCompressionQualityFloor: '0.75',
      ocrTargetMaxKb: 800,
      dashboardLayout: {
        sections: [{ id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: false }] }],
      },
    });

    const result = await updateCurrentUserPreferences(makeUser({ id: 'user-with-dashboard-preference' }), {
      dashboardLayout: {
        sections: [{ id: 'summary', visible: true, cards: [{ id: 'invoice-balance', visible: false }] }],
      },
    });

    expect(result.preferences.imageCompressionEnabled).toBe(false);
    expect(result.preferences.imageCompressionQualityFloor).toBe(0.75);
    expect(result.preferences.dashboardLayout.sections[0].cards[0]).toEqual({ id: 'invoice-balance', visible: false });
    expect(mockDb.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-with-dashboard-preference' },
      update: expect.objectContaining({ dashboardLayout: expect.any(Object) }),
    }));
  });

  it('rejects dashboard layouts that move a card into the wrong section', async () => {
    mockDb.userPreference.findUnique.mockResolvedValueOnce(null);

    await expect(updateCurrentUserPreferences(makeUser(), {
      dashboardLayout: {
        sections: [{ id: 'summary', visible: true, cards: [{ id: 'released-unpaid-invoices', visible: true }] }],
      },
    })).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('lists system setting audit logs with actor and changes', async () => {
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-2',
        createdAt: new Date('2026-03-11T07:20:00.000Z'),
        metadata: {
          updatedKeys: ['SWIFT_WARNING_TOLERANCE'],
          changes: [{ key: 'SWIFT_WARNING_TOLERANCE', before: '5', after: '6' }],
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
      {
        id: 'audit-1',
        createdAt: new Date('2026-03-11T07:10:00.000Z'),
        metadata: {
          changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }],
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
    ]);

    const result = await listSystemSettingsAuditLogs(makeUser(), { limit: 1 });

    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
      where: expect.objectContaining({
        action: 'SYSTEM_SETTINGS_UPDATE',
        targetType: 'SYSTEM_SETTING',
      }),
    }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'audit-2',
      updatedKeys: ['SWIFT_WARNING_TOLERANCE'],
      changes: [{ key: 'SWIFT_WARNING_TOLERANCE', before: '5', after: '6' }],
    }));
    expect(result.nextCursor).toBe('audit-2');
    expect(result.meta).toEqual(expect.objectContaining({
      maxPageSize: 100,
      maxExportRows: 5000,
      cursorMode: 'id',
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_AUDIT_VIEW',
      targetType: 'SYSTEM_SETTING',
      actorId: 'admin-1',
      metadata: expect.objectContaining({
        rowCount: 1,
        limit: 1,
        nextCursor: 'audit-2',
        filters: expect.objectContaining({
          actor: '',
          key: '',
        }),
      }),
    }));
  });

  it('exports all filtered system setting audit logs without pagination cursor', async () => {
    mockDb.auditLog.findMany
      .mockResolvedValueOnce([
        {
          id: 'audit-3',
          createdAt: new Date('2026-03-11T08:10:00.000Z'),
          metadata: {
            updatedKeys: ['OCR_DISABLED'],
            changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }],
          },
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
        },
        {
          id: 'audit-2',
          createdAt: new Date('2026-03-11T08:00:00.000Z'),
          metadata: {
            updatedKeys: ['SWIFT_WARNING_TOLERANCE'],
            changes: [{ key: 'SWIFT_WARNING_TOLERANCE', before: '5', after: '6' }],
          },
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await listAllSystemSettingsAuditLogs(makeUser(), {
      actor: 'admin@example.com',
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 'audit-3',
      updatedKeys: ['OCR_DISABLED'],
    }));
    expect(result.exportLimit).toBe(5000);
    expect(result.maxExportRows).toBe(5000);
    expect(result.truncated).toBe(false);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_AUDIT_EXPORT',
      metadata: expect.objectContaining({
        rowCount: 2,
        exportLimit: 5000,
        maxExportRows: 5000,
        truncated: false,
        exportedKeys: ['OCR_DISABLED', 'SWIFT_WARNING_TOLERANCE'],
        filters: expect.objectContaining({
          actor: 'admin@example.com',
        }),
      }),
    }));
    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 200,
    }));
  });

  it('lists settings audit export history with filters and pagination', async () => {
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-export-2',
        createdAt: new Date('2026-03-11T08:20:00.000Z'),
        metadata: {
          rowCount: 88,
          exportLimit: 100,
          maxExportRows: 5000,
          truncated: true,
          exportedKeys: ['OCR_DISABLED', 'SWIFT_WARNING_TOLERANCE'],
          filters: {
            actor: 'admin@example.com',
            key: 'OCR_DISABLED',
            dateFrom: '2026-03-11T07:00',
            dateTo: '2026-03-11T08:00',
          },
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
      {
        id: 'audit-export-1',
        createdAt: new Date('2026-03-11T08:10:00.000Z'),
        metadata: {
          rowCount: 20,
          exportLimit: 20,
          maxExportRows: 5000,
          truncated: false,
          exportedKeys: ['DETAIL_RECEIPT_MATCH_TOLERANCE'],
          filters: {
            actor: '',
            key: 'DETAIL_RECEIPT_MATCH_TOLERANCE',
            dateFrom: '',
            dateTo: '',
          },
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
    ]);

    const result = await listSystemSettingsAuditExportLogs(makeUser(), {
      limit: 1,
      key: 'OCR_DISABLED',
    });

    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: 'SYSTEM_SETTINGS_AUDIT_EXPORT',
        targetType: 'SYSTEM_SETTING',
      }),
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'audit-export-2',
        rowCount: 88,
        truncated: true,
        filterKey: 'OCR_DISABLED',
        exportedKeys: ['OCR_DISABLED', 'SWIFT_WARNING_TOLERANCE'],
      }),
    ]);
    expect(result.nextCursor).toBeNull();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_AUDIT_EXPORT_HISTORY_VIEW',
      targetType: 'SYSTEM_SETTING',
      actorId: 'admin-1',
      metadata: expect.objectContaining({
        rowCount: 1,
        limit: 1,
        nextCursor: null,
        filters: expect.objectContaining({
          actor: '',
          key: 'OCR_DISABLED',
        }),
      }),
    }));
  });

  it('filters system setting audit logs by actor, time range, and setting key', async () => {
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-3',
        createdAt: new Date('2026-03-11T08:10:00.000Z'),
        metadata: {
          updatedKeys: ['OCR_DISABLED'],
          changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }],
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
      {
        id: 'audit-2',
        createdAt: new Date('2026-03-11T08:00:00.000Z'),
        metadata: {
          updatedKeys: ['SWIFT_WARNING_TOLERANCE'],
          changes: [{ key: 'SWIFT_WARNING_TOLERANCE', before: '5', after: '6' }],
        },
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
      {
        id: 'audit-1',
        createdAt: new Date('2026-03-11T07:30:00.000Z'),
        metadata: {
          updatedKeys: ['OCR_DISABLED'],
          changes: [{ key: 'OCR_DISABLED', before: 'true', after: 'false' }],
        },
        actor: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
      },
    ]);

    const result = await listSystemSettingsAuditLogs(makeUser(), {
      actor: 'admin@example.com',
      key: 'OCR_DISABLED',
      dateFrom: '2026-03-11',
      dateTo: '2026-03-11',
      limit: 20,
    });

    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        action: 'SYSTEM_SETTINGS_UPDATE',
        targetType: 'SYSTEM_SETTING',
        createdAt: expect.objectContaining({
          gte: new Date('2026-03-11T00:00:00.000'),
          lte: new Date('2026-03-11T23:59:59.999'),
        }),
        actor: {
          is: {
            OR: [
              { id: 'admin@example.com' },
              { email: { contains: 'admin@example.com' } },
              { name: { contains: 'admin@example.com' } },
            ],
          },
        },
      }),
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'audit-3',
        updatedKeys: ['OCR_DISABLED'],
      }),
    ]);
  });

  it('rejects reversed audit date ranges', async () => {
    await expect(listSystemSettingsAuditLogs(makeUser(), {
      dateFrom: '2026-03-11T09:00',
      dateTo: '2026-03-11T08:00',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '结束时间不能早于开始时间',
    });
  });

  it('rejects invalid audit date inputs', async () => {
    await expect(listSystemSettingsAuditLogs(makeUser(), {
      dateFrom: 'bad-date',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'dateFrom 格式错误',
    });
  });

  it('rejects non-admin audit reads and export history reads', async () => {
    const salesUser = makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    });

    await expect(listSystemSettingsAuditLogs(salesUser)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: '只有管理员可以查看系统配置审计',
    });

    await expect(listSystemSettingsAuditExportLogs(salesUser)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: '只有管理员可以查看系统配置审计',
    });
  });

  it('filters settings audit export history by actor, key, date range, and cursor', async () => {
    mockDb.auditLog.findMany
      .mockResolvedValueOnce([
        {
          id: 'audit-export-3',
          createdAt: new Date('2026-03-11T09:30:00.000Z'),
          metadata: {
            rowCount: 10,
            exportLimit: 20,
            maxExportRows: 5000,
            truncated: false,
            exportedKeys: ['OCR_DISABLED'],
            filters: {
              actor: 'admin@example.com',
              key: 'OCR_DISABLED',
              dateFrom: '2026-03-11',
              dateTo: '2026-03-11',
            },
          },
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
        },
        {
          id: 'audit-export-2',
          createdAt: new Date('2026-03-10T09:30:00.000Z'),
          metadata: {
            rowCount: 5,
            exportLimit: 20,
            maxExportRows: 5000,
            truncated: false,
            exportedKeys: ['SWIFT_WARNING_TOLERANCE'],
            filters: {
              actor: '',
              key: 'SWIFT_WARNING_TOLERANCE',
              dateFrom: '',
              dateTo: '',
            },
          },
          actor: { id: 'sales-1', email: 'sales@example.com', name: 'Sales' },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await listSystemSettingsAuditExportLogs(makeUser(), {
      cursor: 'audit-export-0',
      limit: 20,
      actor: 'admin@example.com',
      key: 'OCR_DISABLED',
      dateFrom: '2026-03-11',
      dateTo: '2026-03-11',
    });

    expect(mockDb.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { id: 'audit-export-0' },
      skip: 1,
      where: expect.objectContaining({
        action: 'SYSTEM_SETTINGS_AUDIT_EXPORT',
        targetType: 'SYSTEM_SETTING',
        createdAt: expect.objectContaining({
          gte: new Date('2026-03-11T00:00:00.000'),
          lte: new Date('2026-03-11T23:59:59.999'),
        }),
      }),
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'audit-export-3',
        filterActor: 'admin@example.com',
        filterKey: 'OCR_DISABLED',
      }),
    ]);
  });

  it('validates swift tolerance ordering before saving config', async () => {
    await expect(updateSystemSettings(makeUser(), {
      SWIFT_WARNING_TOLERANCE: '10',
      SWIFT_REJECT_TOLERANCE: '5',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'SWIFT_REJECT_TOLERANCE 不能小于 SWIFT_WARNING_TOLERANCE',
    });
  });

  it('requires all customer analytics rules in one atomic submission', async () => {
    await expect(updateSystemSettings(makeUser(), {
      CUSTOMER_ANALYTICS_NORMAL_DAYS: '31',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });

    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['reversed thresholds', { CUSTOMER_ANALYTICS_NORMAL_DAYS: '60', CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '30' }],
    ['equal thresholds', { CUSTOMER_ANALYTICS_NORMAL_DAYS: '60', CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '60' }],
    ['decimal threshold', { CUSTOMER_ANALYTICS_DELAY_DAYS: '90.5' }],
    ['zero threshold', { CUSTOMER_ANALYTICS_NORMAL_DAYS: '0' }],
    ['negative threshold', { CUSTOMER_ANALYTICS_NORMAL_DAYS: '-1' }],
    ['excessive threshold', { CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS: '3651' }],
    ['decimal lookback', { CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '12.5' }],
    ['excessive lookback', { CUSTOMER_ANALYTICS_LOOKBACK_MONTHS: '61' }],
  ])('rejects invalid customer analytics %s without side effects', async (_label, update) => {
    await expect(updateSystemSettings(makeUser(), {
      ...validAnalyticsSettings,
      ...update,
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });

    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.systemSetting.upsert).not.toHaveBeenCalled();
    expect(mockInvalidateSystemSettingsCache).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it.each([UserRole.SALES, UserRole.USER])(
    'forbids %s accounts from updating customer analytics settings',
    async (role) => {
      await expect(updateSystemSettings(makeUser({ role }), {
        CUSTOMER_ANALYTICS_NORMAL_DAYS: '31',
      })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });

      expect(mockGetSystemSettingsWithDefaults).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    },
  );

  it('transactionally saves valid customer analytics settings and audits before and after values', async () => {
    mockDb.systemSetting.upsert.mockResolvedValue(undefined);

    const result = await updateSystemSettings(makeUser(), validAnalyticsSettings);

    expect(result).toEqual({ message: '配置已更新' });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.systemSetting.upsert).toHaveBeenCalledTimes(7);
    expect(mockInvalidateSystemSettingsCache).toHaveBeenCalledTimes(1);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_UPDATE',
      actorId: 'admin-1',
      metadata: {
        updatedKeys: [
          'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS',
          'CUSTOMER_ANALYTICS_NORMAL_DAYS',
          'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS',
          'CUSTOMER_ANALYTICS_DELAY_DAYS',
          'CUSTOMER_ANALYTICS_WARNING_DAYS',
          'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS',
          'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS',
        ],
        changes: [
          { key: 'CUSTOMER_ANALYTICS_LOOKBACK_MONTHS', before: '12', after: '18' },
          { key: 'CUSTOMER_ANALYTICS_NORMAL_DAYS', before: '30', after: '35' },
          { key: 'CUSTOMER_ANALYTICS_MILD_DELAY_DAYS', before: '60', after: '65' },
          { key: 'CUSTOMER_ANALYTICS_DELAY_DAYS', before: '90', after: '95' },
          { key: 'CUSTOMER_ANALYTICS_WARNING_DAYS', before: '120', after: '125' },
          { key: 'CUSTOMER_ANALYTICS_DOUBLE_WARNING_DAYS', before: '150', after: '155' },
          { key: 'CUSTOMER_ANALYTICS_SEVERE_WARNING_DAYS', before: '180', after: '185' },
        ],
      },
    }));
  });

  it('upserts settings and invalidates cache on save', async () => {
    mockDb.systemSetting.upsert.mockResolvedValue(undefined);

    const result = await updateSystemSettings(makeUser(), {
      DETAIL_RECEIPT_MATCH_TOLERANCE: '7',
      SWIFT_WARNING_TOLERANCE: '6',
      SWIFT_REJECT_TOLERANCE: '60',
    });

    expect(result.message).toBe('配置已更新');
    expect(mockDb.systemSetting.upsert).toHaveBeenCalledTimes(3);
    expect(mockInvalidateSystemSettingsCache).toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_UPDATE',
      metadata: expect.objectContaining({
        updatedKeys: ['DETAIL_RECEIPT_MATCH_TOLERANCE', 'SWIFT_WARNING_TOLERANCE', 'SWIFT_REJECT_TOLERANCE'],
      }),
    }));
  });

  it('allows unrelated settings updates when stored analytics rules are malformed', async () => {
    const malformedStoredSettings = {
      OCR_DISABLED: 'false',
      OCR_API_KEY: 'old-secret',
      DETAIL_RECEIPT_MATCH_TOLERANCE: '5',
      SWIFT_WARNING_TOLERANCE: '5',
      SWIFT_REJECT_TOLERANCE: '50',
      SETTINGS_AUDIT_MAX_PAGE_SIZE: '100',
      SETTINGS_AUDIT_EXPORT_MAX_ROWS: '5000',
      ...validAnalyticsSettings,
      CUSTOMER_ANALYTICS_NORMAL_DAYS: 'invalid-legacy-value',
      CUSTOMER_ANALYTICS_MILD_DELAY_DAYS: '50',
    };
    mockGetSystemSettingsWithDefaults.mockResolvedValueOnce(malformedStoredSettings);
    mockDb.systemSetting.upsert.mockResolvedValue(undefined);

    const result = await updateSystemSettings(makeUser(), {
      ...malformedStoredSettings,
      OCR_DISABLED: 'true',
    });

    expect(result).toEqual({ message: '配置已更新' });
    expect(mockDb.systemSetting.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'OCR_DISABLED' },
    }));
  });

  it('clamps audit page size and export limit to configured server caps', async () => {
    mockGetSystemSettingsWithDefaults.mockResolvedValue({
      OCR_DISABLED: 'false',
      OCR_API_KEY: 'old-secret',
      DETAIL_RECEIPT_MATCH_TOLERANCE: '5',
      SWIFT_WARNING_TOLERANCE: '5',
      SWIFT_REJECT_TOLERANCE: '50',
      SETTINGS_AUDIT_MAX_PAGE_SIZE: '30',
      SETTINGS_AUDIT_EXPORT_MAX_ROWS: '200',
    });
    mockDb.auditLog.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const paged = await listSystemSettingsAuditLogs(makeUser(), { limit: 999 });
    const exported = await listAllSystemSettingsAuditLogs(makeUser(), { exportLimit: 999 });

    expect(paged.limit).toBe(30);
    expect(paged.meta).toEqual({
      defaultPageSize: 20,
      maxPageSize: 30,
      maxExportRows: 200,
      pageSizeOptions: [20, 30],
      cursorMode: 'id',
    });
    expect(exported.exportLimit).toBe(200);
    expect(exported.maxExportRows).toBe(200);
  });

  it('clamps malformed audit capabilities to minimum values in settings overview', async () => {
    mockGetSystemSettingsWithDefaults.mockResolvedValue({
      OCR_DISABLED: 'false',
      OCR_API_KEY: 'old-secret',
      DETAIL_RECEIPT_MATCH_TOLERANCE: '5',
      SWIFT_WARNING_TOLERANCE: '5',
      SWIFT_REJECT_TOLERANCE: '50',
      SETTINGS_AUDIT_MAX_PAGE_SIZE: '0',
      SETTINGS_AUDIT_EXPORT_MAX_ROWS: '-9',
    });
    mockDb.user.findMany.mockResolvedValueOnce([]);

    const result = await listSettings(makeUser());

    expect(result.auditCapabilities).toEqual({
      defaultPageSize: 1,
      maxPageSize: 1,
      maxExportRows: 1,
      pageSizeOptions: [1],
      cursorMode: 'id',
    });
  });

  it('clamps negative export limit to one row and marks export as truncated', async () => {
    mockDb.auditLog.findMany
      .mockResolvedValueOnce([
        {
          id: 'audit-3',
          createdAt: new Date('2026-03-11T08:10:00.000Z'),
          metadata: {
            updatedKeys: ['OCR_DISABLED'],
            changes: [{ key: 'OCR_DISABLED', before: 'false', after: 'true' }],
          },
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
        },
        {
          id: 'audit-2',
          createdAt: new Date('2026-03-11T08:00:00.000Z'),
          metadata: {
            updatedKeys: ['SWIFT_WARNING_TOLERANCE'],
            changes: [{ key: 'SWIFT_WARNING_TOLERANCE', before: '5', after: '6' }],
          },
          actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await listAllSystemSettingsAuditLogs(makeUser(), { exportLimit: -5 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('audit-3');
    expect(result.exportLimit).toBe(1);
    expect(result.truncated).toBe(true);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SYSTEM_SETTINGS_AUDIT_EXPORT',
      metadata: expect.objectContaining({
        exportLimit: 1,
        truncated: true,
      }),
    }));
  });

  it('normalizes malformed export history metadata and clamps negative page limit', async () => {
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-export-2',
        createdAt: new Date('2026-03-11T08:20:00.000Z'),
        metadata: {
          rowCount: 'not-a-number',
          exportLimit: null,
          maxExportRows: undefined,
          truncated: 0,
          exportedKeys: ['OCR_DISABLED', '', null],
          filters: {
            actor: 123,
            key: null,
            dateFrom: undefined,
            dateTo: '2026-03-11',
          },
        },
        actor: null,
      },
      {
        id: 'audit-export-1',
        createdAt: new Date('2026-03-11T08:10:00.000Z'),
        metadata: {},
        actor: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
      },
    ]);

    const result = await listSystemSettingsAuditExportLogs(makeUser(), { limit: -2 });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'audit-export-2',
        rowCount: 0,
        exportLimit: 0,
        maxExportRows: 0,
        truncated: false,
        filterActor: '123',
        filterKey: '',
        filterDateFrom: '',
        filterDateTo: '2026-03-11',
        exportedKeys: ['OCR_DISABLED'],
      }),
    ]);
    expect(result.nextCursor).toBe('audit-export-2');
    expect(result.limit).toBe(1);
  });

  it('masks secret values in settings audit logs', async () => {
    mockDb.systemSetting.upsert.mockResolvedValue(undefined);

    await updateSystemSettings(makeUser(), {
      OCR_API_KEY: 'new-secret',
    });

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        changes: [
          {
            key: 'OCR_API_KEY',
            before: '[masked]',
            after: '[masked]',
          },
        ],
      }),
    }));
  });

  it('rejects invalid boolean config values', async () => {
    await expect(updateSystemSettings(makeUser(), {
      OCR_DISABLED: 'maybe',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'OCR_DISABLED 必须为 true 或 false',
    });
  });

  it('rejects invalid numeric config values', async () => {
    await expect(updateSystemSettings(makeUser(), {
      DETAIL_RECEIPT_MATCH_TOLERANCE: '-1',
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'DETAIL_RECEIPT_MATCH_TOLERANCE 必须为不小于 0 的数字',
    });
  });

  it('accepts valid boolean config values and records the change', async () => {
    mockDb.systemSetting.upsert.mockResolvedValue(undefined);

    const result = await updateSystemSettings(makeUser(), {
      OCR_DISABLED: 'true',
    });

    expect(result.message).toBe('配置已更新');
    expect(mockDb.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'OCR_DISABLED' },
      update: expect.objectContaining({
        value: 'true',
      }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        updatedKeys: ['OCR_DISABLED'],
      }),
    }));
  });

  it('rejects invalid settings payload objects', async () => {
    await expect(updateSystemSettings(makeUser(), null)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '配置参数无效',
    });
  });

  it('returns no-change when no editable settings are provided', async () => {
    const result = await updateSystemSettings(makeUser(), {});

    expect(result).toEqual({ message: '无变更' });
    expect(mockDb.systemSetting.upsert).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).not.toHaveBeenCalled();
  });

  it('tests OCR connectivity for admins and returns detail text', async () => {
    mockTestOcrConnectivity.mockResolvedValueOnce({
      success: true,
      message: 'ok',
      detail: 'pong',
    });

    const result = await testSettingsOcr(makeUser());

    expect(result).toEqual({ message: 'ok', detail: 'pong' });
  });

  it('surfaces OCR connectivity failures as structured errors', async () => {
    mockTestOcrConnectivity.mockResolvedValueOnce({
      success: false,
      message: 'OCR disabled',
      detail: 'OCR_DISABLED=true',
    });

    await expect(testSettingsOcr(makeUser())).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'OCR disabled',
      detail: 'OCR_DISABLED=true',
    });
  });

  it('purges business data without touching system settings', async () => {
    const result = await purgeBusinessData(makeUser());

    expect(result.message).toMatch(/系统配置\/用户数据保留/);
    expect(mockDb.systemSetting.upsert).not.toHaveBeenCalled();
    expect(mockDb.detailItem.deleteMany).toHaveBeenCalled();
    expect(mockDb.auditLog.deleteMany).toHaveBeenCalled();
  });

  it('rejects full business purge for non-admin users', async () => {
    await expect(purgeBusinessData(makeUser({ role: UserRole.SALES, level: 3 }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('rejects branch purge when target or password is missing', async () => {
    await expect(purgeBranchBusinessData(makeUser(), {
      targetUserId: 'sales-1',
      password: '',
      modules: ['all'],
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '缺少目标账号或密码',
    });
  });

  it('rejects branch purge when selected modules resolve to empty set', async () => {
    await expect(purgeBranchBusinessData(makeUser(), {
      targetUserId: 'sales-1',
      password: 'Admin@2026!',
      modules: ['unknown-module'],
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '至少选择一个清理模块',
    });
  });

  it('rejects branch purge when admin password is wrong', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'admin-1', password: 'hashed' });
    mockVerifyPassword.mockResolvedValueOnce(false);

    await expect(purgeBranchBusinessData(makeUser(), {
      targetUserId: 'sales-1',
      password: 'bad-password',
      modules: ['all'],
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '密码错误',
    });
  });

  it('rejects branch purge when target account does not exist', async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce({ id: 'admin-1', password: 'hashed' })
      .mockResolvedValueOnce(null);
    mockVerifyPassword.mockResolvedValueOnce(true);

    await expect(purgeBranchBusinessData(makeUser(), {
      targetUserId: 'missing-user',
      password: 'Admin@2026!',
      modules: ['invoice'],
    })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: '目标账户不存在',
    });
  });

  it('purges only the requested branch modules when a subset is selected', async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce({ id: 'admin-1', password: 'hashed' })
      .mockResolvedValueOnce({ id: 'sales-1', role: UserRole.SALES, email: 'sales@example.com', name: 'Sales', level: 3 });
    mockVerifyPassword.mockResolvedValueOnce(true);
    mockDb.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', parentId: null },
      { id: 'sales-1', parentId: 'admin-1' },
      { id: 'user-1', parentId: 'sales-1' },
    ]);
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', invoiceId: 'invoice-1' }]);
    mockDb.invoice.findMany.mockResolvedValueOnce([{ id: 'invoice-1' }]);
    mockDb.receipt.findMany.mockResolvedValueOnce([{ id: 'receipt-1' }]);
    mockDb.detail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    mockDb.swift.findMany.mockResolvedValueOnce([{ id: 'swift-1', detailId: 'detail-1' }]);
    mockDb.customer.findMany.mockResolvedValueOnce([{ id: 'customer-1' }]);

    const result = await purgeBranchBusinessData(makeUser(), {
      targetUserId: 'sales-1',
      password: 'Admin@2026!',
      modules: ['invoice', 'swift'],
    });

    expect(result.data.modules).toEqual(['invoice', 'swift']);
    expect(mockDb.swift.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['swift-1'] } } });
    expect(mockDb.order.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['order-1'] } } });
    expect(mockDb.invoice.deleteMany).toHaveBeenCalled();
    expect(mockDb.detail.deleteMany).not.toHaveBeenCalled();
    expect(mockDb.customer.deleteMany).not.toHaveBeenCalled();
  });

  it('purges selected branch modules and preserves settings/users', async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce({ id: 'admin-1', password: 'hashed' })
      .mockResolvedValueOnce({ id: 'sales-1', role: UserRole.SALES, email: 'sales@example.com', name: 'Sales', level: 3 });
    mockVerifyPassword.mockResolvedValueOnce(true);
    mockDb.user.findMany
      .mockResolvedValueOnce([
        { id: 'admin-1', parentId: null },
        { id: 'sales-1', parentId: 'admin-1' },
        { id: 'user-1', parentId: 'sales-1' },
      ]);
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', invoiceId: 'invoice-1' }]);
    mockDb.invoice.findMany.mockResolvedValueOnce([{ id: 'invoice-2' }]);
    mockDb.receipt.findMany.mockResolvedValueOnce([{ id: 'receipt-1' }]);
    mockDb.detail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    mockDb.swift.findMany.mockResolvedValueOnce([{ id: 'swift-1', detailId: 'detail-1' }]);
    mockDb.customer.findMany.mockResolvedValueOnce([{ id: 'customer-1' }]);

    const result = await purgeBranchBusinessData(makeUser(), {
      targetUserId: 'sales-1',
      password: 'Admin@2026!',
      modules: ['all'],
    });

    expect(result.data.modules).toEqual(['invoice', 'receipt', 'detail', 'swift', 'customer']);
    expect(mockDb.detailItem.updateMany).toHaveBeenCalled();
    expect(mockDb.receipt.updateMany).toHaveBeenCalled();
    expect(mockDb.balanceTransfer.deleteMany).toHaveBeenCalled();
    expect(mockDb.swift.deleteMany).toHaveBeenCalled();
    expect(mockDb.invoice.deleteMany).toHaveBeenCalled();
    expect(mockDb.customer.deleteMany).toHaveBeenCalled();
    expect(mockDb.deletionRequest.deleteMany).toHaveBeenCalled();
    expect(mockDb.auditLog.deleteMany).toHaveBeenCalled();
  });

  it('rejects OCR testing for non-admin', async () => {
    await expect(testSettingsOcr(makeUser({ role: UserRole.SALES, level: 3 }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});
