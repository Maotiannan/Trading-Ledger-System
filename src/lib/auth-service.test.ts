import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  changeCurrentUserPassword,
  createManagedUser,
  deleteManagedUser,
  resetManagedUserPassword,
  updateManagedUserRole,
} from '@/lib/auth-service';

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    invoice: { updateMany: jest.fn() },
    order: { updateMany: jest.fn() },
    receipt: { updateMany: jest.fn() },
    receiptHistory: { updateMany: jest.fn() },
    detail: { updateMany: jest.fn() },
    detailHistory: { updateMany: jest.fn() },
    swift: { updateMany: jest.fn() },
    customer: { updateMany: jest.fn() },
    deletionRequest: { updateMany: jest.fn() },
    auditLog: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

function makeUser(overrides: Partial<{
  id: string;
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
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  invoice: { updateMany: jest.Mock };
  order: { updateMany: jest.Mock };
  receipt: { updateMany: jest.Mock };
  receiptHistory: { updateMany: jest.Mock };
  detail: { updateMany: jest.Mock };
  detailHistory: { updateMany: jest.Mock };
  swift: { updateMany: jest.Mock };
  customer: { updateMany: jest.Mock };
  deletionRequest: { updateMany: jest.Mock };
  auditLog: { updateMany: jest.Mock };
  $transaction: jest.Mock;
};

const mockHashPassword = hashPassword as jest.Mock;
const mockVerifyPassword = verifyPassword as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;

describe('auth-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetHierarchyScope.mockResolvedValue({
      visibleIds: new Set(['admin-1', 'sales-parent']),
      descendantIds: new Set(['sales-child', 'user-child']),
    });
    mockHashPassword.mockResolvedValue('hashed-password');
    mockVerifyPassword.mockResolvedValue(true);
  });

  it('creates managed user in transaction and records audit', async () => {
    mockDb.user.findUnique
      .mockResolvedValueOnce({ id: 'sales-parent', level: 2, role: UserRole.ADMIN })
      .mockResolvedValueOnce(null);
    mockDb.user.create.mockResolvedValueOnce({
      id: 'sales-child',
      email: 'sales@example.com',
      name: 'Sales',
      role: UserRole.SALES,
      level: 3,
      parentId: 'sales-parent',
      createdAt: new Date('2026-03-11T00:00:00.000Z'),
      createdById: 'admin-1',
    });

    const result = await createManagedUser(makeUser(), {
      email: 'sales@example.com',
      password: 'Sales@2026!',
      role: UserRole.SALES,
      parentId: 'sales-parent',
      name: 'Sales',
    });

    expect(mockDb.user.create).toHaveBeenCalled();
    expect(result.data.role).toBe(UserRole.SALES);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_CREATE',
      targetType: 'USER',
      targetId: 'sales-child',
    }));
  });

  it('updates managed user role and records previous role metadata', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'user-child',
      email: 'user@example.com',
      name: 'User',
      role: UserRole.USER,
      level: 4,
      createdById: 'sales-child',
    });
    mockDb.user.update.mockResolvedValueOnce({
      id: 'user-child',
      email: 'user@example.com',
      name: 'User',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdAt: new Date('2026-03-11T00:00:00.000Z'),
      createdById: 'sales-child',
    });

    const result = await updateManagedUserRole(makeUser(), {
      userId: 'user-child',
      role: UserRole.SALES,
    });

    expect(result.data.role).toBe(UserRole.SALES);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_ROLE_UPDATE',
      metadata: expect.objectContaining({ previousRole: UserRole.USER, nextRole: UserRole.SALES }),
    }));
  });

  it('deletes subordinate user in transaction and reassigns ownership', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'user-child',
      email: 'user@example.com',
      name: 'User',
      role: UserRole.USER,
      level: 4,
      createdById: 'sales-child',
    });

    await deleteManagedUser(makeUser(), 'user-child');

    expect(mockDb.invoice.updateMany).toHaveBeenCalledWith({ where: { createdBy: 'user-child' }, data: { createdBy: 'admin-1' } });
    expect(mockDb.user.delete).toHaveBeenCalledWith({ where: { id: 'user-child' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_DELETE',
      targetId: 'user-child',
    }));
  });

  it('resets subordinate password and records audit', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({
      id: 'user-child',
      email: 'user@example.com',
      level: 4,
    });

    await resetManagedUserPassword(makeUser(), {
      userId: 'user-child',
      password: 'Reset@2026!',
    });

    expect(mockDb.user.update).toHaveBeenCalledWith({ where: { id: 'user-child' }, data: { password: 'hashed-password' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_PASSWORD_RESET' }));
  });

  it('changes current user password after verifying old password', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'admin-1', password: 'legacy-hash' });

    await changeCurrentUserPassword(makeUser(), {
      oldPassword: 'Old@2026!',
      newPassword: 'New@2026!',
    });

    expect(mockVerifyPassword).toHaveBeenCalledWith('Old@2026!', 'legacy-hash');
    expect(mockDb.user.update).toHaveBeenCalledWith({ where: { id: 'admin-1' }, data: { password: 'hashed-password' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_PASSWORD_CHANGE' }));
  });
});
