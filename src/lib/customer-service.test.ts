import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  findDuplicateCustomersInScope,
  findPhoneConflictCustomersInScope,
  resolveCustomerOwnerId,
} from '@/lib/customer-scope';
import {
  createCustomerRecord,
  deleteCustomerRecord,
  processCustomerImportRows,
  updateCustomerRecord,
} from '@/lib/customer-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
  getSystemSettings: jest.fn(),
}));

jest.mock('@/lib/customer-scope', () => ({
  assertNoCustomerScopeConflict: jest.fn(),
  customerAccessWhere: jest.fn(() => ({})),
  findDuplicateCustomersInScope: jest.fn(),
  findPhoneConflictCustomersInScope: jest.fn(),
  mapPrismaWriteError: jest.fn((error: unknown) => error instanceof Error ? error.message : '数据库错误'),
  resolveCustomerOwnerId: jest.fn(),
}));

function makeUser(overrides: Partial<{
  id: string;
  role: UserRole;
  level: number;
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
  customer: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findUnique: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetSystemSettings = getSystemSettings as jest.Mock;
const mockResolveCustomerOwnerId = resolveCustomerOwnerId as jest.Mock;
const mockFindDuplicateCustomersInScope = findDuplicateCustomersInScope as jest.Mock;
const mockFindPhoneConflictCustomersInScope = findPhoneConflictCustomersInScope as jest.Mock;
const mockAssertNoCustomerScopeConflict = assertNoCustomerScopeConflict as jest.Mock;

describe('customer-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetSystemSettings.mockResolvedValue({ SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: 'true' });
    mockResolveCustomerOwnerId.mockResolvedValue('sales-1');
    mockFindDuplicateCustomersInScope.mockResolvedValue([]);
    mockFindPhoneConflictCustomersInScope.mockResolvedValue([]);
    mockAssertNoCustomerScopeConflict.mockResolvedValue(undefined);
  });

  it('creates customer in transaction and records audit', async () => {
    mockDb.customer.create.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    });

    const result = await createCustomerRecord(makeUser(), {
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    }, 'sales-1');

    expect(mockDb.customer.create).toHaveBeenCalled();
    expect(result.message).toBe('客户已创建');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_CREATE',
      targetType: 'CUSTOMER',
      targetId: 'customer-1',
    }));
  });

  it('rejects duplicate customer creation before write', async () => {
    mockFindDuplicateCustomersInScope.mockResolvedValueOnce([
      {
        id: 'customer-dup',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        ownerEmail: 'sales@example.com',
      },
    ]);

    await expect(createCustomerRecord(makeUser(), {
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    }, 'sales-1')).rejects.toMatchObject({
      code: 'CUSTOMER_DUPLICATE',
      status: 400,
    });

    expect(mockDb.customer.create).not.toHaveBeenCalled();
  });

  it('updates customer in transaction and records owner changes', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce({
      id: 'customer-1',
      ownerId: 'sales-1',
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
    });
    mockDb.customer.update.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB-NEW',
      orderName: 'IB-NEW',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    });

    const result = await updateCustomerRecord(makeUser(), 'customer-1', {
      mark: 'IB-NEW',
      orderName: 'IB-NEW',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    }, 'sales-1');

    expect(result.message).toBe('客户已更新');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_UPDATE',
      targetId: 'customer-1',
    }));
  });

  it('deletes customer and records audit', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB',
      orderName: 'IB',
      ownerId: 'sales-1',
    });

    const result = await deleteCustomerRecord(makeUser(), 'customer-1');

    expect(result.message).toBe('客户已删除');
    expect(mockDb.customer.delete).toHaveBeenCalledWith({ where: { id: 'customer-1' } });
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_DELETE',
      targetId: 'customer-1',
    }));
  });

  it('blocks sales from updating another owner customer', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce({
      id: 'customer-1',
      ownerId: 'sales-owner',
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
    });

    await expect(updateCustomerRecord(makeUser({
      id: 'sales-2',
      role: UserRole.SALES,
      level: 3,
    }), 'customer-1', {
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
    })).rejects.toMatchObject({
      code: 'CUSTOMER_SCOPE_FORBIDDEN',
      status: 403,
    });
  });

  it('imports valid rows and summarizes audit once', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'sales-1', email: 'sales@example.com' }]);
    mockDb.user.findUnique.mockResolvedValueOnce({ email: 'sales@example.com' });
    mockDb.customer.create.mockResolvedValueOnce({
      id: 'customer-2',
      mark: 'MDP',
      orderName: 'MDP',
      name: 'Mdp Name',
      phone: '622000001',
      city: 'Conakry',
    });

    const result = await processCustomerImportRows([
      {
        rowNo: 2,
        ownerEmail: 'sales@example.com',
        payload: {
          mark: 'MDP',
          orderName: 'MDP',
          name: 'Mdp Name',
          phone: '622000001',
          city: 'Conakry',
          consignee: null,
          companyName: null,
          companyAddress: null,
          credit: 0,
        },
      },
    ], makeUser(), 'sales-1');

    expect(result.success).toBe(true);
    expect(result.createdCount).toBe(1);
    expect(mockRecordAuditEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'CUSTOMER_CREATE' }));
    expect(mockRecordAuditEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'CUSTOMER_IMPORT' }));
  });

  it('marks import row failed when sales email is unknown', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);

    const result = await processCustomerImportRows([
      {
        rowNo: 5,
        ownerEmail: 'missing-sales@example.com',
        payload: {
          mark: 'MISS',
          orderName: 'MISS',
          name: 'Missing Sales',
          phone: '622000009',
          city: 'Conakry',
          consignee: null,
          companyName: null,
          companyAddress: null,
          credit: 0,
        },
      },
    ], makeUser(), 'sales-1');

    expect(result.success).toBe(false);
    expect(result.issueRows).toEqual([
      expect.objectContaining({
        rowNo: 5,
        reason: expect.stringContaining('SALES_EMAIL不存在'),
      }),
    ]);
    expect(mockDb.customer.create).not.toHaveBeenCalled();
  });
});
