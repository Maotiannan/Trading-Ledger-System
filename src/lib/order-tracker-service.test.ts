import { ReceiptStatus, UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { getSystemSettingsWithDefaults } from '@/lib/system-settings';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  createOrderTracker,
  listOrderTrackers,
  updateOrderTracker,
} from '@/lib/order-tracker-service';

jest.mock('@/lib/db', () => ({
  db: (() => {
    const mockedDb: Record<string, unknown> = {
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    orderTracker: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
    },
    externalOrderSourceLink: {
      updateMany: jest.fn(),
    },
    };
    mockedDb.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => (
      callback(mockedDb)
    ));
    return mockedDb;
  })(),
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAlias: jest.fn(),
}));

jest.mock('@/lib/user-hierarchy', () => ({
  getHierarchyScope: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
  getSystemSettingsWithDefaults: jest.fn(async () => ({
    ORDER_TRACKER_STATUS_OPTIONS: 'In progress,Confirmed,Canceled',
  })),
}));

function makeUser(overrides: Partial<{
  id: string;
  role: UserRole;
  level: number;
  parentId: string | null;
}> = {}) {
  return {
    id: 'sales-1',
    email: 'sales@example.com',
    name: 'Sales',
    role: UserRole.SALES,
    level: 3,
    parentId: 'admin-1',
    createdById: 'admin-1',
    ...overrides,
  };
}

const mockDb = db as unknown as {
  $transaction: jest.Mock;
  customer: { findFirst: jest.Mock; findMany: jest.Mock };
  order: { findUnique: jest.Mock };
  orderTracker: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  receipt: { findMany: jest.Mock };
  externalOrderSourceLink: { updateMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockGetSystemSettingsWithDefaults = getSystemSettingsWithDefaults as jest.Mock;

describe('order-tracker-service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) => (
      callback(mockDb)
    ));
    mockGetSystemSettingsWithDefaults.mockResolvedValue({
      ORDER_TRACKER_STATUS_OPTIONS: 'In progress,Confirmed,Canceled',
    });
    mockGetHierarchyScope.mockResolvedValue({
      selfId: 'sales-1',
      ancestorIds: new Set(['admin-1']),
      descendantIds: new Set(['user-1']),
      visibleIds: new Set(['admin-1', 'sales-1', 'user-1']),
      ownerVisibleIds: new Set(['sales-1', 'user-1']),
    });
    mockRecordAuditEvent.mockResolvedValue(undefined);
    mockFindOrderIdByNoOrAlias.mockResolvedValue(null);
  });

  it('allows creating an Orders-page record even when the order already exists in finance orders or aliases', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('finance-order-1');
    mockDb.orderTracker.findFirst.mockResolvedValueOnce(null);
    mockDb.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'PIKIN',
      orderName: 'PIKIN',
      name: 'Mamadou Dian Diallo',
      phone: '622491286',
      city: 'Conakry',
      ownerId: 'sales-1',
    });
    mockDb.orderTracker.create.mockResolvedValueOnce({
      id: 'tracker-finance-1',
      orderNo: 'PIKIN-20',
      status: 'In progress',
    });

    const result = await createOrderTracker(makeUser(), {
      orderNo: 'PIKIN-20',
      customerId: 'customer-1',
    });

    expect(result.data.id).toBe('tracker-finance-1');
    expect(mockDb.orderTracker.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNo: 'PIKIN-20',
        normalizedOrderNo: 'pikin-20',
      }),
    }));
  });

  it('creates an independent Orders-page record with a customer snapshot and default status', async () => {
    mockDb.orderTracker.findFirst.mockResolvedValueOnce(null);
    mockDb.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'PIKIN',
      orderName: 'PIKIN',
      name: 'Mamadou Dian Diallo',
      phone: '622491286',
      city: 'Conakry',
      ownerId: 'sales-1',
    });
    mockDb.orderTracker.create.mockResolvedValueOnce({
      id: 'tracker-1',
      orderNo: 'PIKIN-23',
      status: 'In progress',
      piStatus: false,
      customerMark: 'PIKIN',
    });

    const result = await createOrderTracker(makeUser(), {
      orderNo: 'PIKIN-23',
      customerId: 'customer-1',
      remark: 'prepare PI',
    });

    expect(mockDb.orderTracker.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNo: 'PIKIN-23',
        normalizedOrderNo: 'pikin-23',
        status: 'In progress',
        confirmedAt: null,
        remark: 'prepare PI',
        customerId: 'customer-1',
        customerMark: 'PIKIN',
        customerName: 'PIKIN',
        customerPhone: '622491286',
        createdBy: 'sales-1',
      }),
    }));
    expect(result.data.id).toBe('tracker-1');
  });

  it('records a confirmation timestamp when a record is created as Confirmed', async () => {
    mockDb.orderTracker.findFirst.mockResolvedValueOnce(null);
    mockDb.customer.findFirst.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'PIKIN',
      orderName: 'PIKIN',
      name: 'Mamadou Dian Diallo',
      phone: '622491286',
      city: 'Conakry',
      ownerId: 'sales-1',
    });
    mockDb.orderTracker.create.mockResolvedValueOnce({
      id: 'tracker-confirmed',
      orderNo: 'PIKIN-24',
      status: 'Confirmed',
    });

    await createOrderTracker(makeUser(), {
      orderNo: 'PIKIN-24',
      customerId: 'customer-1',
      status: 'Confirmed',
    });

    const createData = mockDb.orderTracker.create.mock.calls[0][0].data;
    expect(createData.confirmedAt).toBeInstanceOf(Date);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        status: 'Confirmed',
        confirmedAt: createData.confirmedAt.toISOString(),
      }),
    }));
  });

  it('infers the customer and links the visible finance order when customerId is not provided', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('finance-order-1');
    mockDb.orderTracker.findFirst.mockResolvedValueOnce(null);
    mockDb.order.findUnique.mockResolvedValueOnce({
      id: 'finance-order-1',
      orderNo: 'FATAKO-01',
      customerId: 'customer-fatako',
      customerMark: 'BAL2 FATAKO',
      customerName: 'FATAKO',
      customerPhone: '+224 623 63 65 09',
      customerCity: 'Conakry',
      customer: {
        id: 'customer-fatako',
        mark: 'BAL2 FATAKO',
        orderName: 'FATAKO',
        name: 'Mamadou Oury Balde',
        phone: '+224 623 63 65 09',
        city: 'Conakry',
        ownerId: 'sales-1',
      },
    });
    mockDb.orderTracker.create.mockResolvedValueOnce({
      id: 'tracker-fatako',
      orderNo: 'FATAKO-01',
      financeOrderId: 'finance-order-1',
      customerId: 'customer-fatako',
      status: 'In progress',
    });

    const result = await createOrderTracker(makeUser(), {
      orderNo: 'FATAKO-01',
    });

    expect(result.data.id).toBe('tracker-fatako');
    expect(mockDb.customer.findFirst).not.toHaveBeenCalled();
    expect(mockDb.orderTracker.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderNo: 'FATAKO-01',
        financeOrderId: 'finance-order-1',
        customerId: 'customer-fatako',
        customerMark: 'BAL2 FATAKO',
        customerName: 'FATAKO',
        customerPhone: '+224 623 63 65 09',
      }),
    }));
  });

  it('sums deposit receipts by exact order and slash-separated composite order segments', async () => {
    mockDb.orderTracker.findMany.mockResolvedValueOnce([
      {
        id: 'tracker-1',
        orderNo: 'PIKIN-23/PIKIN-19C',
        status: 'In progress',
        confirmedAt: new Date('2026-05-15T10:00:00.000Z'),
        piStatus: false,
        remark: null,
        systemNote: null,
        customerId: 'customer-1',
        customerMark: 'PIKIN',
        customerName: 'PIKIN',
        customerPhone: '622491286',
        customerCity: 'Conakry',
        createdBy: 'sales-1',
        updatedBy: null,
        amount: 0,
        orderBalance: 0,
        createdAt: new Date('2026-05-14T00:00:00.000Z'),
        updatedAt: new Date('2026-05-14T00:00:00.000Z'),
        creator: { id: 'sales-1', email: 'sales@example.com', name: 'Sales', role: UserRole.SALES },
        customer: { id: 'customer-1', ownerId: 'sales-1', mark: 'PIKIN', orderName: 'PIKIN' },
      },
    ]);
    mockDb.receipt.findMany.mockResolvedValueOnce([
      { orderNo: 'PIKIN-23', usd: 1000, status: ReceiptStatus.SR_Received, order: null },
      { orderNo: 'OTHER-01', usd: 500, status: ReceiptStatus.SR_Received, order: null },
      { orderNo: null, usd: 300, status: ReceiptStatus.SR_Received, order: { orderNo: 'PIKIN-19C' } },
    ]);

    const result = await listOrderTrackers(makeUser(), {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].depositAmount).toBe(1300);
    expect(result.data[0].confirmedAt).toEqual(new Date('2026-05-15T10:00:00.000Z'));
  });

  it('requires an upper ADMIN account to update PI status and system note', async () => {
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      createdBy: 'user-1',
      customer: { ownerId: 'sales-1' },
    });

    await expect(updateOrderTracker(makeUser(), 'tracker-1', {
      piStatus: true,
      systemNote: 'PI approved',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    expect(mockDb.orderTracker.update).not.toHaveBeenCalled();
  });

  it('allows a sales-visible account to update status and remark without admin fields', async () => {
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'In progress',
      confirmedAt: null,
      createdBy: 'admin-1',
      customer: { ownerId: 'sales-1' },
    });
    mockDb.orderTracker.update.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'Confirmed',
      remark: 'Customer confirmed',
    });

    await updateOrderTracker(makeUser(), 'tracker-1', {
      status: 'Confirmed',
      remark: 'Customer confirmed',
    });

    expect(mockDb.orderTracker.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'tracker-1' },
      data: expect.objectContaining({
        status: 'Confirmed',
        remark: 'Customer confirmed',
        updatedBy: 'sales-1',
      }),
    }));
    const updateData = mockDb.orderTracker.update.mock.calls[0][0].data;
    expect(updateData.confirmedAt).toBeInstanceOf(Date);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        fields: expect.arrayContaining(['status', 'confirmedAt', 'remark']),
        statusBefore: 'In progress',
        statusAfter: 'Confirmed',
        confirmedAtBefore: null,
        confirmedAtAfter: updateData.confirmedAt.toISOString(),
      }),
    }));
  });

  it('marks an active source link as human-edited in the same transaction', async () => {
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'In progress',
      confirmedAt: null,
      createdBy: 'sales-1',
      customer: { ownerId: 'sales-1' },
    });
    mockDb.orderTracker.update.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'Confirmed',
    });

    await updateOrderTracker(makeUser(), 'tracker-1', { status: 'Confirmed' });

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.externalOrderSourceLink.updateMany).toHaveBeenCalledWith({
      where: { orderTrackerId: 'tracker-1', active: true },
      data: {
        humanEditedAt: expect.any(Date),
        humanEditedBy: 'sales-1',
      },
    });
  });

  it('clears the timestamp when a Confirmed record leaves that status', async () => {
    const previousConfirmedAt = new Date('2026-07-01T08:00:00.000Z');
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'Confirmed',
      confirmedAt: previousConfirmedAt,
      createdBy: 'sales-1',
      customer: { ownerId: 'sales-1' },
    });
    mockDb.orderTracker.update.mockResolvedValueOnce({ id: 'tracker-1', status: 'Canceled', confirmedAt: null });

    await updateOrderTracker(makeUser(), 'tracker-1', { status: 'Canceled' });

    expect(mockDb.orderTracker.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'Canceled', confirmedAt: null }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        statusBefore: 'Confirmed',
        statusAfter: 'Canceled',
        confirmedAtBefore: previousConfirmedAt.toISOString(),
        confirmedAtAfter: null,
      }),
    }));
  });

  it('preserves the timestamp when Confirmed is saved without a status transition', async () => {
    const previousConfirmedAt = new Date('2026-07-01T08:00:00.000Z');
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'Confirmed',
      confirmedAt: previousConfirmedAt,
      createdBy: 'sales-1',
      customer: { ownerId: 'sales-1' },
    });
    mockDb.orderTracker.update.mockResolvedValueOnce({ id: 'tracker-1', status: 'Confirmed', confirmedAt: previousConfirmedAt });

    await updateOrderTracker(makeUser(), 'tracker-1', {
      status: 'Confirmed',
      remark: 'No status change',
    });

    const updateData = mockDb.orderTracker.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('confirmedAt');
    expect(mockRecordAuditEvent.mock.calls[0][0].metadata).not.toHaveProperty('statusBefore');
  });

  it('preserves the timestamp for a remark-only update', async () => {
    const previousConfirmedAt = new Date('2026-07-01T08:00:00.000Z');
    mockDb.orderTracker.findUnique.mockResolvedValueOnce({
      id: 'tracker-1',
      status: 'Confirmed',
      confirmedAt: previousConfirmedAt,
      createdBy: 'sales-1',
      customer: { ownerId: 'sales-1' },
    });
    mockDb.orderTracker.update.mockResolvedValueOnce({ id: 'tracker-1', status: 'Confirmed', confirmedAt: previousConfirmedAt });

    await updateOrderTracker(makeUser(), 'tracker-1', { remark: 'Only the remark changed' });

    expect(mockDb.orderTracker.update.mock.calls[0][0].data).not.toHaveProperty('confirmedAt');
  });
});
