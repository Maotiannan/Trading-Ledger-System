import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  getCurrentAccount,
  listManagedUserParentOptions,
  listManagedUsers,
} from '@/lib/auth-read-service';

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

function makeUser(overrides: Partial<{ id: string; role: UserRole; level: number }> = {}) {
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

const mockDb = db as unknown as { user: { findMany: jest.Mock } };
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;

describe('auth-read-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns current account and records audit', async () => {
    const result = await getCurrentAccount(makeUser());

    expect(result.message).toBe('当前用户信息已加载');
    expect(result.data.email).toBe('admin@example.com');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_SELF_VIEW',
      targetId: 'admin-1',
    }));
  });

  it('lists parent options filtered by target role', async () => {
    mockGetHierarchyScope.mockResolvedValueOnce({ visibleIds: new Set(['admin-1', 'admin-2', 'sales-1']) });
    mockDb.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1 },
      { id: 'admin-2', email: 'admin2@example.com', name: 'Admin2', role: UserRole.ADMIN, level: 2 },
      { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
    ]);

    const result = await listManagedUserParentOptions(makeUser(), UserRole.SALES);

    expect(result.data).toHaveLength(2);
    expect(result.data.every((row) => row.role === UserRole.ADMIN)).toBe(true);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_PARENT_OPTIONS_VIEW',
      metadata: expect.objectContaining({ targetRole: UserRole.SALES, candidateCount: 2 }),
    }));
  });

  it('lists managed users for visible scope and records audit', async () => {
    mockGetHierarchyScope.mockResolvedValueOnce({ visibleIds: new Set(['sales-1', 'user-1']) });
    mockDb.user.findMany.mockResolvedValueOnce([
      { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3, parentId: 'admin-1', createdAt: new Date(), createdById: 'admin-1' },
      { id: 'user-1', email: 'user@example.com', name: 'User', role: UserRole.USER, level: 4, parentId: 'sales-1', createdAt: new Date(), createdById: 'sales-1' },
    ]);

    const result = await listManagedUsers(makeUser());

    expect(result.data).toHaveLength(2);
    expect(result.message).toContain('2 个账号');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_LIST_VIEW',
      metadata: expect.objectContaining({ count: 2 }),
    }));
  });
});
