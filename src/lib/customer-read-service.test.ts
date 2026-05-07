import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import {
  getCustomerOrderNameHistory,
  listCustomerOwnerOptions,
  listCustomers,
} from '@/lib/customer-read-service';
import { canSalesEditExtendedCustomerFields } from '@/lib/customer-service';

jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/customer-service', () => ({
  canSalesEditExtendedCustomerFields: jest.fn(),
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
  user: { findMany: jest.Mock };
  customer: { findMany: jest.Mock; findFirst: jest.Mock };
  order: { findMany: jest.Mock };
  receipt: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockCanSalesEditExtendedCustomerFields = canSalesEditExtendedCustomerFields as jest.Mock;

describe('customer-read-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanSalesEditExtendedCustomerFields.mockResolvedValue(true);
  });

  it('lists owner options and records audit', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1 },
      { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
    ]);

    const result = await listCustomerOwnerOptions(makeUser());

    expect(result.data).toHaveLength(2);
    expect(result.message).toContain('2 个账号');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_OWNER_OPTIONS_VIEW',
      metadata: expect.objectContaining({ count: 2 }),
    }));
  });

  it('returns only self as owner option for sales user', async () => {
    const salesUser = makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      name: 'Sales',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    });

    const result = await listCustomerOwnerOptions(salesUser);

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'sales-1',
        email: 'sales@example.com',
        role: UserRole.SALES,
      }),
    ]);
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
  });

  it('rejects non-manager owner option reads', async () => {
    await expect(listCustomerOwnerOptions(makeUser({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      level: 4,
      parentId: 'sales-1',
      createdById: 'sales-1',
    }))).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权限',
    });
  });

  it('hides extended fields for sales when setting is disabled', async () => {
    mockCanSalesEditExtendedCustomerFields.mockResolvedValueOnce(false);
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: 'Hidden Co',
        companyAddress: 'Address',
        credit: 100,
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    }), { search: 'Ibrahima' });

    expect(result.data).toEqual([
      expect.objectContaining({
        companyName: null,
        companyAddress: null,
        credit: null,
      }),
    ]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_LIST_VIEW',
      metadata: expect.objectContaining({ count: 1, showExtended: false }),
    }));
  });

  it('filters sales list using visible fields only', async () => {
    mockCanSalesEditExtendedCustomerFields.mockResolvedValueOnce(false);
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: 'Hidden Co',
        companyAddress: 'Secret Address',
        credit: 100,
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    }), { search: 'Hidden Co' });

    expect(result.data).toEqual([]);
  });

  it('keeps extended fields for sales when setting allows them', async () => {
    mockCanSalesEditExtendedCustomerFields.mockResolvedValueOnce(true);
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: 'Visible Co',
        companyAddress: 'Visible Address',
        credit: 100,
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser({
      id: 'sales-1',
      email: 'sales@example.com',
      role: UserRole.SALES,
      level: 3,
      parentId: 'admin-1',
      createdById: 'admin-1',
    }), { search: 'Visible Co' });

    expect(result.data).toEqual([
      expect.objectContaining({
        companyName: 'Visible Co',
        companyAddress: 'Visible Address',
        credit: 100,
      }),
    ]);
  });

  it('filters mark lookups while ignoring spaces', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'SDT 2',
        orderName: 'SUPER DT 2',
        orderNames: [{ orderName: 'SUPER DT 2', normalizedOrderName: 'superdt2', isPrimary: true }],
        name: 'Super DT',
        phone: '622443103',
        city: 'Conakry',
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
      {
        id: 'customer-2',
        mark: 'MAB 1',
        orderName: 'MAB-1',
        orderNames: [{ orderName: 'MAB-1', normalizedOrderName: 'mab-1', isPrimary: true }],
        name: 'MAB',
        phone: '620000000',
        city: 'Conakry',
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser(), { mark: 'S D T2' });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'customer-1',
        mark: 'SDT 2',
      }),
    ]);
  });

  it('rejects non-manager customer list reads', async () => {
    await expect(listCustomers(makeUser({
      id: 'user-1',
      email: 'user@example.com',
      role: UserRole.USER,
      level: 4,
      parentId: 'sales-1',
      createdById: 'sales-1',
    }), { search: 'IB' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      message: '无权限',
    });
  });

  it('applies exact mark filter before returning customers', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: 'IB Co',
        companyAddress: 'Address',
        credit: 0,
        owner: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser(), { mark: 'IB', search: '' });

    expect(mockDb.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
    expect(result.data).toHaveLength(1);
    expect(result.message).toContain('1 个客户');
  });

  it('lets admin search extended customer fields', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: 'Hidden Co',
        companyAddress: 'Secret Address',
        credit: 100,
        owner: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser(), { search: 'Secret Address' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(expect.objectContaining({
      companyAddress: 'Secret Address',
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_LIST_VIEW',
      metadata: expect.objectContaining({ count: 1, search: 'Secret Address', showExtended: true }),
    }));
  });

  it('marks phone conflicts within the same owner scope', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        companyName: null,
        companyAddress: null,
        credit: 0,
        ownerId: 'sales-1',
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
      {
        id: 'customer-2',
        mark: 'SARA',
        orderName: 'SARA',
        name: 'Sara Diallo',
        phone: '622443103',
        city: 'Conakry',
        companyName: null,
        companyAddress: null,
        credit: 0,
        ownerId: 'sales-1',
        owner: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-13T00:00:00Z'),
      },
      {
        id: 'customer-3',
        mark: 'OTHER',
        orderName: 'OTHER',
        name: 'Other Branch',
        phone: '622443103',
        city: 'Conakry',
        companyName: null,
        companyAddress: null,
        credit: 0,
        ownerId: 'sales-2',
        owner: { id: 'sales-2', email: 'sales2@example.com', name: 'Sales 2', role: UserRole.SALES, level: 3 },
        createdAt: new Date('2026-03-14T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser(), { search: '' });

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'customer-1',
        phoneConflict: true,
        phoneConflictMessage: '手机号冲突，请修改',
      }),
      expect.objectContaining({
        id: 'customer-2',
        phoneConflict: true,
        phoneConflictMessage: '手机号冲突，请修改',
      }),
      expect.objectContaining({
        id: 'customer-3',
        phoneConflict: false,
      }),
    ]);
  });

  it('returns customer order-name aliases for customer management edits', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'MAB',
        orderName: 'MAB-1',
        name: 'Mamadou Aliou Barry',
        phone: '+224 620 07 11 76',
        city: 'Conakry',
        companyName: 'MAB Co',
        companyAddress: 'Address',
        credit: 0,
        ownerId: 'admin-1',
        orderNames: [
          { orderName: 'MAB-1', normalizedOrderName: 'mab-1', isPrimary: true },
          { orderName: 'MARY', normalizedOrderName: 'mary', isPrimary: false },
        ],
        owner: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: UserRole.ADMIN, level: 1 },
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
    ]);

    const result = await listCustomers(makeUser(), { search: 'MAB' });

    expect(result.data).toEqual([
      expect.objectContaining({
        orderNames: [
          expect.objectContaining({ orderName: 'MAB-1', isPrimary: true }),
          expect.objectContaining({ orderName: 'MARY', isPrimary: false }),
        ],
      }),
    ]);
  });

  it('returns selected ORDER_NAME history and recent receipts for a visible customer', async () => {
    mockDb.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'MAB',
      orderName: 'MAB-1',
      orderNames: [
        { orderName: 'MAB-1', normalizedOrderName: 'mab-1', isPrimary: true },
        { orderName: 'MARY', normalizedOrderName: 'mary', isPrimary: false },
      ],
    });
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-1',
        orderNo: 'MAB-1-10',
        amount: 1000,
        orderBalance: 250,
        invoice: { invNo: 'L25MH090001' },
        createdAt: new Date('2026-05-07T00:00:00Z'),
      },
      {
        id: 'order-2',
        orderNo: 'MARY-01',
        amount: 500,
        orderBalance: 0,
        invoice: { invNo: 'L25MH090002' },
        createdAt: new Date('2026-05-08T00:00:00Z'),
      },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      {
        id: 'receipt-1',
        receiptNo: '0001001',
        orderNo: 'MAB-1-10',
        invNo: 'L25MH090001',
        usd: 750,
        status: 'RECEIVED',
        date: new Date('2026-05-07T00:00:00Z'),
        createdAt: new Date('2026-05-07T00:00:00Z'),
      },
    ]);

    const result = await getCustomerOrderNameHistory(makeUser(), {
      customerId: 'customer-1',
      orderName: 'MAB-1',
    });

    expect(result.data.orders).toEqual([
      {
        id: 'order-1',
        orderNo: 'MAB-1-10',
        invNo: 'L25MH090001',
        amount: 1000,
        outstanding: 250,
      },
    ]);
    expect(result.data.receipts).toEqual([
      expect.objectContaining({
        id: 'receipt-1',
        receiptNo: '0001001',
        status: 'RECEIVED',
      }),
    ]);
    expect(mockDb.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'customer-1' }),
    }));
  });
});
