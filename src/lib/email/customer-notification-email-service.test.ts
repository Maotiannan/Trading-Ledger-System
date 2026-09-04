import { CustomerEmailLanguage, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import {
  addCustomerNotificationEmail,
  deleteCustomerNotificationEmail,
  listCustomerNotificationEmails,
  setPrimaryCustomerNotificationEmail,
  updateCustomerNotificationEmail,
  updateCustomerNotificationLanguage,
} from '@/lib/email/customer-notification-email-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: { findFirst: jest.fn(), update: jest.fn() },
    customerNotificationEmail: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    emailNotification: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

const mockDb = db as unknown as {
  customer: { findFirst: jest.Mock; update: jest.Mock };
  customerNotificationEmail: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
  };
  emailNotification: { updateMany: jest.Mock };
  auditLog: { create: jest.Mock };
  $queryRaw: jest.Mock;
  $transaction: jest.Mock;
};

const adminUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  level: 1,
  parentId: null,
  createdById: null,
};

const salesUser = {
  ...adminUser,
  id: 'sales-1',
  email: 'sales@example.com',
  role: UserRole.SALES,
  level: 3,
  parentId: 'admin-1',
  createdById: 'admin-1',
};

const userAccount = {
  ...salesUser,
  id: 'user-1',
  email: 'user@example.com',
  role: UserRole.USER,
  level: 4,
  parentId: 'sales-1',
  createdById: 'sales-1',
};

const firstEmail = {
  id: 'email-1',
  customerId: 'customer-1',
  email: 'primary@example.com',
  normalizedEmail: 'primary@example.com',
  isPrimary: true,
  createdBy: 'admin-1',
  updatedBy: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
};

describe('customer notification email service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockDb.customer.findFirst.mockResolvedValue({
      id: 'customer-1',
      ownerId: 'sales-1',
      notificationLanguage: CustomerEmailLanguage.ENGLISH,
    });
    mockDb.customerNotificationEmail.findMany.mockResolvedValue([]);
    mockDb.customerNotificationEmail.findFirst.mockResolvedValue(null);
    mockDb.customerNotificationEmail.findUnique.mockResolvedValue(firstEmail);
    mockDb.customerNotificationEmail.create.mockImplementation(async ({ data }) => ({
      ...firstEmail,
      ...data,
    }));
    mockDb.customerNotificationEmail.update.mockImplementation(async ({ data }) => ({
      ...firstEmail,
      ...data,
    }));
    mockDb.customerNotificationEmail.updateMany.mockResolvedValue({ count: 1 });
    mockDb.customerNotificationEmail.delete.mockResolvedValue(firstEmail);
    mockDb.customerNotificationEmail.count.mockResolvedValue(1);
    mockDb.customer.update.mockResolvedValue({
      id: 'customer-1',
      notificationLanguage: CustomerEmailLanguage.FRENCH,
    });
    mockDb.emailNotification.updateMany.mockResolvedValue({ count: 0 });
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    mockDb.$queryRaw.mockResolvedValue([{ id: 'customer-1' }]);
  });

  it.each([
    [adminUser, true],
    [salesUser, true],
    [userAccount, false],
  ])('enforces customer email maintenance for role $role', async (currentUser, allowed) => {
    if (allowed) {
      await expect(listCustomerNotificationEmails(currentUser, 'customer-1')).resolves.toMatchObject({
        language: 'ENGLISH',
      });
    } else {
      await expect(listCustomerNotificationEmails(currentUser, 'customer-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    }
  });

  it('does not reveal an out-of-scope customer to sales', async () => {
    mockDb.customer.findFirst.mockResolvedValueOnce(null);

    await expect(listCustomerNotificationEmails(salesUser, 'customer-2')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
    expect(mockDb.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'customer-2', ownerId: 'sales-1' }),
    }));
  });

  it('makes the first address primary and restores missing-recipient tasks', async () => {
    const result = await addCustomerNotificationEmail(adminUser, 'customer-1', 'Primary@Example.com');

    expect(mockDb.customerNotificationEmail.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        email: 'Primary@Example.com',
        normalizedEmail: 'primary@example.com',
        isPrimary: true,
        createdBy: 'admin-1',
      }),
    });
    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mockDb.emailNotification.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-1', status: 'MISSING_RECIPIENT' },
      data: { status: 'PENDING' },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalled();
    expect(result.data.isPrimary).toBe(true);
  });

  it('rejects a case-insensitive duplicate within one customer', async () => {
    mockDb.customerNotificationEmail.findFirst.mockResolvedValueOnce(firstEmail);

    await expect(addCustomerNotificationEmail(adminUser, 'customer-1', 'PRIMARY@example.com')).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect(mockDb.customerNotificationEmail.create).not.toHaveBeenCalled();
  });

  it('updates an address without changing its primary state', async () => {
    const result = await updateCustomerNotificationEmail(
      adminUser,
      'customer-1',
      'email-1',
      'billing@example.com',
    );

    expect(mockDb.customerNotificationEmail.update).toHaveBeenCalledWith({
      where: { id: 'email-1' },
      data: {
        email: 'billing@example.com',
        normalizedEmail: 'billing@example.com',
        updatedBy: 'admin-1',
      },
    });
    expect(result.data).toMatchObject({ email: 'billing@example.com', isPrimary: true });
  });

  it('promotes the oldest remaining address when deleting the primary', async () => {
    const secondary = {
      ...firstEmail,
      id: 'email-2',
      email: 'secondary@example.com',
      normalizedEmail: 'secondary@example.com',
      isPrimary: false,
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    };
    mockDb.customerNotificationEmail.findMany
      .mockResolvedValueOnce([firstEmail, secondary])
      .mockResolvedValueOnce([{ ...secondary, isPrimary: true }]);

    const result = await deleteCustomerNotificationEmail(adminUser, 'customer-1', 'email-1');

    expect(mockDb.customerNotificationEmail.delete).toHaveBeenCalledWith({ where: { id: 'email-1' } });
    expect(mockDb.customerNotificationEmail.updateMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'customer-1' },
      data: { isPrimary: false, updatedBy: 'admin-1' },
    });
    expect(mockDb.customerNotificationEmail.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'email-2' },
      data: { isPrimary: true, updatedBy: 'admin-1' },
    });
    expect(result.data[0]).toMatchObject({ id: 'email-2', isPrimary: true });
  });

  it('returns pending tasks to missing-recipient when deleting the last address', async () => {
    mockDb.customerNotificationEmail.findMany
      .mockResolvedValueOnce([firstEmail])
      .mockResolvedValueOnce([]);
    mockDb.customerNotificationEmail.count.mockResolvedValueOnce(0);

    await deleteCustomerNotificationEmail(adminUser, 'customer-1', 'email-1');

    expect(mockDb.emailNotification.updateMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-1', status: 'PENDING' },
      data: { status: 'MISSING_RECIPIENT' },
    });
  });

  it('switches the primary address transactionally', async () => {
    const secondary = { ...firstEmail, id: 'email-2', isPrimary: false };
    mockDb.customerNotificationEmail.findUnique.mockResolvedValueOnce(secondary);

    await setPrimaryCustomerNotificationEmail(adminUser, 'customer-1', 'email-2');

    expect(mockDb.customerNotificationEmail.updateMany).toHaveBeenNthCalledWith(1, {
      where: { customerId: 'customer-1' },
      data: { isPrimary: false, updatedBy: 'admin-1' },
    });
    expect(mockDb.customerNotificationEmail.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'email-2' },
      data: { isPrimary: true, updatedBy: 'admin-1' },
    });
  });

  it('updates one customer-wide language preference', async () => {
    const result = await updateCustomerNotificationLanguage(
      adminUser,
      'customer-1',
      CustomerEmailLanguage.FRENCH,
    );

    expect(mockDb.customer.update).toHaveBeenCalledWith({
      where: { id: 'customer-1' },
      data: { notificationLanguage: CustomerEmailLanguage.FRENCH },
      select: { notificationLanguage: true },
    });
    expect(result.language).toBe(CustomerEmailLanguage.FRENCH);
  });
});
