import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getSystemSettings } from '@/lib/system-settings';
import {
  decodeCustomerSyncCursor,
  encodeCustomerSyncCursor,
  syncCustomers,
} from '@/lib/customer-sync-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
  getSystemSettings: jest.fn(),
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
  customer: { findMany: jest.Mock };
  auditLog: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetSystemSettings = getSystemSettings as jest.Mock;

describe('customer-sync-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-15T10:00:00.000Z'));
    mockGetSystemSettings.mockResolvedValue({ SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: 'true' });
    mockDb.customer.findMany.mockResolvedValue([]);
    mockDb.auditLog.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns visible customer upserts and a reusable next cursor', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'PIKIN',
        normalizedMark: 'pikin',
        orderName: 'PIKIN',
        name: 'Mamadou Dian Diallo',
        phone: '622491286',
        city: 'Conakry',
        consignee: 'Mamadou',
        companyName: 'DMD MERCERIE',
        companyAddress: 'Madina',
        credit: '500000.00',
        ownerId: 'sales-1',
        createdBy: 'admin-1',
        createdAt: new Date('2026-05-14T09:00:00.000Z'),
        updatedAt: new Date('2026-05-15T09:30:00.000Z'),
        orderNames: [
          { orderName: 'PIKIN', normalizedOrderName: 'pikin', isPrimary: true },
          { orderName: 'PIKIN OLD', normalizedOrderName: 'pikinold', isPrimary: false },
        ],
      },
    ]);

    const result = await syncCustomers(makeUser(), {});

    expect(result.data.customers).toEqual([
      {
        id: 'customer-1',
        mark: 'PIKIN',
        normalizedMark: 'pikin',
        orderName: 'PIKIN',
        orderNames: ['PIKIN', 'PIKIN OLD'],
        name: 'Mamadou Dian Diallo',
        phone: '622491286',
        city: 'Conakry',
        consignee: 'Mamadou',
        companyName: 'DMD MERCERIE',
        companyAddress: 'Madina',
        credit: 500000,
        ownerId: 'sales-1',
        createdBy: 'admin-1',
        createdAt: '2026-05-14T09:00:00.000Z',
        updatedAt: '2026-05-15T09:30:00.000Z',
        syncState: 'UPSERT',
      },
    ]);
    expect(result.data.deleted).toEqual([]);
    expect(result.data.disabled).toEqual([]);
    expect(result.data.hasMore).toBe(false);
    expect(decodeCustomerSyncCursor(result.data.nextCursor).customer?.updatedAt).toBe('2026-05-15T09:30:00.000Z');
    expect(mockDb.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ orderNames: expect.any(Object) }),
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_SYNC_VIEW',
      metadata: expect.objectContaining({ customerCount: 1, deletedCount: 0 }),
    }));
  });

  it('returns delete tombstones from customer delete audit logs after the cursor', async () => {
    const cursor = encodeCustomerSyncCursor({
      customer: { updatedAt: '2026-05-15T08:00:00.000Z', id: 'customer-old' },
      deleted: { deletedAt: '2026-05-15T08:00:00.000Z', id: 'audit-old' },
    });
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-delete-1',
        targetId: 'customer-deleted',
        actorId: 'admin-1',
        createdAt: new Date('2026-05-15T09:15:00.000Z'),
        metadata: {
          ownerId: 'sales-1',
          mark: 'AB',
          orderName: 'AB',
        },
      },
    ]);

    const result = await syncCustomers(makeUser(), { since: cursor });

    expect(result.data.customers).toEqual([]);
    expect(result.data.deleted).toEqual([
      {
        id: 'customer-deleted',
        ownerId: 'sales-1',
        mark: 'AB',
        orderName: 'AB',
        deletedAt: '2026-05-15T09:15:00.000Z',
        deletedBy: 'admin-1',
        syncState: 'DELETED',
      },
    ]);
    expect(decodeCustomerSyncCursor(result.data.nextCursor).deleted?.id).toBe('audit-delete-1');
  });

  it('hides extended fields for sales when extended customer fields are disabled', async () => {
    mockGetSystemSettings.mockResolvedValueOnce({ SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: 'false' });
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        normalizedMark: 'ib',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: 'Hidden Co',
        companyAddress: 'Hidden Address',
        credit: '100.00',
        ownerId: 'sales-1',
        createdBy: 'sales-1',
        createdAt: new Date('2026-05-14T09:00:00.000Z'),
        updatedAt: new Date('2026-05-15T09:30:00.000Z'),
        orderNames: [],
      },
    ]);
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      {
        id: 'audit-hidden',
        targetId: 'customer-other',
        actorId: 'admin-1',
        createdAt: new Date('2026-05-15T09:35:00.000Z'),
        metadata: { ownerId: 'admin-1', mark: 'ADMIN', orderName: 'ADMIN' },
      },
      {
        id: 'audit-visible',
        targetId: 'customer-sales',
        actorId: 'admin-1',
        createdAt: new Date('2026-05-15T09:40:00.000Z'),
        metadata: { ownerId: 'sales-1', mark: 'SALES', orderName: 'SALES' },
      },
    ]);

    const result = await syncCustomers(makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    }), {});

    expect(mockDb.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: 'sales-1' }),
    }));
    expect(result.data.customers[0]).toEqual(expect.objectContaining({
      companyName: null,
      companyAddress: null,
      credit: null,
    }));
    expect(result.data.deleted).toEqual([
      expect.objectContaining({ id: 'customer-sales', ownerId: 'sales-1' }),
    ]);
  });

  it('rejects user role sync and invalid cursors', async () => {
    await expect(syncCustomers(makeUser({ role: UserRole.USER }), {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(syncCustomers(makeUser(), { since: 'not-a-valid-cursor' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
  });
});
