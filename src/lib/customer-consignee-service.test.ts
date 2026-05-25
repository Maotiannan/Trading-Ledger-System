import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { resolveOrderCustomer } from '@/lib/order-customer-lookup-service';
import {
  addCustomerConsignee,
  deleteCustomerConsignee,
  listCustomerConsignees,
  writeOrderConsignee,
} from '@/lib/customer-consignee-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    customerConsignee: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/order-customer-lookup-service', () => ({
  resolveOrderCustomer: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

const mockDb = db as unknown as {
  customer: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  customerConsignee: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
};
const mockResolveOrderCustomer = resolveOrderCustomer as jest.Mock;

const salesUser = {
  id: 'sales-1',
  email: 'sales@example.com',
  name: 'Sales',
  role: UserRole.SALES,
  level: 3,
  parentId: 'admin-1',
  createdById: 'admin-1',
};

const adminUser = {
  ...salesUser,
  id: 'admin-1',
  email: 'admin@example.com',
  role: UserRole.ADMIN,
  level: 1,
};

describe('customer-consignee-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.customer.findFirst.mockReset();
    mockDb.customer.findUnique.mockReset();
    mockDb.customer.update.mockReset();
    mockDb.customerConsignee.findMany.mockReset();
    mockDb.customerConsignee.findFirst.mockReset();
    mockDb.customerConsignee.findUnique.mockReset();
    mockDb.customerConsignee.create.mockReset();
    mockDb.customerConsignee.delete.mockReset();
    mockDb.customerConsignee.updateMany.mockReset();
    mockDb.$transaction.mockReset();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockDb.customer.findFirst.mockResolvedValue({ id: 'customer-1', ownerId: 'sales-1', consignee: 'Old Consignee' });
    mockDb.customer.findUnique.mockResolvedValue({ id: 'customer-1', ownerId: 'sales-1', consignee: 'Old Consignee' });
    mockDb.customerConsignee.findMany.mockResolvedValue([]);
    mockDb.customerConsignee.findFirst.mockResolvedValue(null);
    mockDb.customerConsignee.findUnique.mockResolvedValue(null);
    mockDb.customerConsignee.create.mockImplementation(async ({ data }) => ({
      id: 'consignee-new',
      ...data,
      createdAt: new Date('2026-05-25T00:00:00.000Z'),
      updatedAt: new Date('2026-05-25T00:00:00.000Z'),
    }));
    mockDb.customer.update.mockResolvedValue({});
    mockDb.customerConsignee.updateMany.mockResolvedValue({ count: 0 });
    mockDb.customerConsignee.delete.mockResolvedValue({ id: 'consignee-1', customerId: 'customer-1', consignee: 'Old Consignee' });
    mockResolveOrderCustomer.mockResolvedValue({
      success: true,
      orderNo: 'AB-12',
      customerId: 'customer-1',
      customer: { id: 'customer-1' },
    });
  });

  it('writes a new consignee for a matched order in one transaction', async () => {
    mockDb.customerConsignee.findMany.mockResolvedValueOnce([]);

    const result = await writeOrderConsignee(salesUser, { orderNo: 'AB-12', consignee: '  New Consignee  ' });

    expect(mockResolveOrderCustomer).toHaveBeenCalledWith(salesUser, 'AB-12');
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.customerConsignee.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'customer-1',
        consignee: 'New Consignee',
        normalizedConsignee: 'new consignee',
        isPrimary: true,
      }),
    }));
    expect(mockDb.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { consignee: 'New Consignee' },
    });
    expect(result).toEqual(expect.objectContaining({
      written: true,
      orderNo: 'AB-12',
      customerId: 'customer-1',
      consigneeId: 'consignee-new',
      consignee: 'New Consignee',
    }));
  });

  it('accepts long consignee text by storing a stable normalized hash for idempotency', async () => {
    const longConsignee = `Name: ${'ALPHA '.repeat(45)}ADDRESS LINE CONAKRY GUINEA`.trim();
    mockDb.customerConsignee.findMany.mockResolvedValueOnce([]);

    const result = await writeOrderConsignee(salesUser, { orderNo: 'AB-12', consignee: longConsignee });

    expect(mockDb.customerConsignee.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'customer-1',
        consignee: longConsignee,
        normalizedConsignee: expect.stringContaining('alpha'),
        normalizedConsigneeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      written: true,
      consignee: longConsignee,
    }));
  });

  it('treats the same order and consignee as idempotent success', async () => {
    mockDb.customerConsignee.findFirst.mockResolvedValueOnce({
      id: 'consignee-1',
      customerId: 'customer-1',
      consignee: 'New Consignee',
      normalizedConsignee: 'new consignee',
      updatedAt: new Date('2026-05-25T01:00:00.000Z'),
    });

    const result = await writeOrderConsignee(salesUser, { orderNo: 'AB-12', consignee: 'New   Consignee' });

    expect(mockDb.customerConsignee.create).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      written: false,
      customerId: 'customer-1',
      consigneeId: 'consignee-1',
      consignee: 'New Consignee',
    }));
  });

  it('lists consignees for a visible customer', async () => {
    mockDb.customerConsignee.findMany.mockResolvedValueOnce([
      { id: 'consignee-1', consignee: 'First', isPrimary: true, createdAt: new Date('2026-05-25'), updatedAt: new Date('2026-05-25') },
    ]);

    const result = await listCustomerConsignees(salesUser, 'customer-1');

    expect(mockDb.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'customer-1' }) }));
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ id: 'consignee-1', consignee: 'First', isPrimary: true }));
  });

  it('adds a consignee through the customer management dialog without overwriting an existing primary', async () => {
    mockDb.customerConsignee.findMany.mockResolvedValueOnce([{ id: 'consignee-1', consignee: 'Old Consignee', isPrimary: true }]);

    const result = await addCustomerConsignee(adminUser, 'customer-1', 'Second Consignee');

    expect(mockDb.customerConsignee.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isPrimary: false }),
    }));
    expect(mockDb.customer.update).not.toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { consignee: 'Second Consignee' },
    });
    expect(result.data).toEqual(expect.objectContaining({ consignee: 'Second Consignee' }));
  });

  it('deletes one consignee and syncs the legacy field to the remaining primary', async () => {
    mockDb.customerConsignee.findUnique.mockResolvedValueOnce({ id: 'consignee-1', customerId: 'customer-1', consignee: 'Old Consignee' });
    mockDb.customerConsignee.findMany
      .mockResolvedValueOnce([{ id: 'consignee-2', consignee: 'Remaining', isPrimary: false }])
      .mockResolvedValueOnce([{ id: 'consignee-2', consignee: 'Remaining', isPrimary: false }]);

    await deleteCustomerConsignee(adminUser, 'customer-1', 'consignee-1');

    expect(mockDb.customerConsignee.delete).toHaveBeenCalledWith({ where: { id: 'consignee-1' } });
    expect(mockDb.customerConsignee.updateMany).toHaveBeenCalledWith({ where: { customerId: 'customer-1' }, data: { isPrimary: false } });
    expect(mockDb.customerConsignee.updateMany).toHaveBeenCalledWith({ where: { id: 'consignee-2' }, data: { isPrimary: true } });
    expect(mockDb.customer.update).toHaveBeenCalledWith({ where: { id: 'customer-1' }, data: { consignee: 'Remaining' } });
  });
});
