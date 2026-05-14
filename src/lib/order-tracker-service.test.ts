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
  db: {
    customer: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
  },
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
  customer: { findFirst: jest.Mock; findMany: jest.Mock };
  orderTracker: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  receipt: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockGetSystemSettingsWithDefaults = getSystemSettingsWithDefaults as jest.Mock;

describe('order-tracker-service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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

  it('rejects creating an Orders-page record when the order already exists in finance orders or aliases', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('finance-order-1');

    await expect(createOrderTracker(makeUser(), {
      orderNo: 'PIKIN-20',
      customerId: 'customer-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: '该 ORDER NO 已存在于财务订单，不能在 Orders 页面新建',
    });

    expect(mockDb.orderTracker.create).not.toHaveBeenCalled();
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

  it('sums deposit receipts by exact order and slash-separated composite order segments', async () => {
    mockDb.orderTracker.findMany.mockResolvedValueOnce([
      {
        id: 'tracker-1',
        orderNo: 'PIKIN-23/PIKIN-19C',
        status: 'In progress',
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
});
