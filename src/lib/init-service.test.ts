import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { initializePrimaryAdmin } from '@/lib/init-service';

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  hashPassword: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

const mockDb = db as unknown as {
  user: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockHashPassword = hashPassword as jest.Mock;
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;

describe('init-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockHashPassword.mockResolvedValue('hashed-password');
  });

  it('initializes primary admin and records audit', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);
    mockDb.user.upsert.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      level: 1,
    });

    const result = await initializePrimaryAdmin({
      email: 'admin@example.com',
      password: 'Admin@2026!',
      name: 'Admin',
    });

    expect(result.message).toBe('管理员初始化成功');
    expect(mockDb.user.upsert).toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_INIT',
      targetId: 'admin-1',
    }));
  });

  it('returns existing-admin message when admin already exists', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: 'admin-1', level: 1, parentId: null, createdById: null });
    mockDb.user.upsert.mockResolvedValueOnce({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      level: 1,
    });

    const result = await initializePrimaryAdmin({
      email: 'admin@example.com',
      password: 'Admin@2026!',
    });

    expect(result.message).toBe('管理员已存在');
  });
});
