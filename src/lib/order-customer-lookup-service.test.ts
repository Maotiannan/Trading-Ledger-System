import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { resolveOrderCustomerBatch } from '@/lib/order-customer-lookup-service';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: jest.fn(),
    },
    customerOrderName: {
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

const mockDb = db as unknown as {
  order: { findMany: jest.Mock };
  customerOrderName: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;

const salesUser = {
  id: 'sales-1',
  email: 'sales@example.com',
  name: 'Sales',
  role: UserRole.SALES,
  level: 3,
  parentId: 'admin-1',
  createdById: 'admin-1',
};

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-1',
    mark: 'MK-GANDO',
    normalizedMark: 'mkgando',
    orderName: 'GANDO',
    orderNames: [
      { orderName: 'GANDO', normalizedOrderName: 'gando', isPrimary: true },
      { orderName: 'GANDO X', normalizedOrderName: 'gandox', isPrimary: false },
    ],
    name: 'Gando Customer',
    phone: '622443103',
    city: 'Conakry',
    consignee: 'Gando Consignee',
    companyName: 'Gando LLC',
    companyAddress: 'Kaloum',
    credit: 250,
    ownerId: 'sales-1',
    ...overrides,
  };
}

function makeLinkedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNo: 'GANDO-10',
    createdAt: new Date('2026-04-28T08:00:00.000Z'),
    invoice: { id: 'invoice-1', invNo: 'INV-1', createdAt: new Date('2026-04-28T08:00:00.000Z') },
    customer: makeCustomer(),
    ...overrides,
  };
}

describe('order-customer-lookup-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHierarchyScope.mockResolvedValue({ ownerVisibleIds: new Set(['sales-1']) });
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.customerOrderName.findMany.mockResolvedValue([]);
  });

  it('resolves full customer data from a visible finance order number', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([makeLinkedOrder()]);

    const result = await resolveOrderCustomerBatch(salesUser, ['GANDO-10']);

    expect(result.results).toEqual([
      expect.objectContaining({
        success: true,
        orderNo: 'GANDO-10',
        matchedBy: 'linked-order',
        matchedOrderNo: 'GANDO-10',
        invNo: 'INV-1',
        customer: expect.objectContaining({
          id: 'customer-1',
          displayName: 'Gando LLC',
          mark: 'MK-GANDO',
          orderNames: ['GANDO', 'GANDO X'],
          name: 'Gando Customer',
          phone: '622443103',
          city: 'Conakry',
          consignee: 'Gando Consignee',
          companyName: 'Gando LLC',
          companyAddress: 'Kaloum',
          credit: 250,
        }),
      }),
    ]);
  });

  it('falls back to derived ORDER_NAME matching with ignore-space rules', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      { orderName: 'SUPER DT2', customer: makeCustomer({ id: 'customer-2', mark: 'SDT 2', orderName: 'SUPER DT2', companyName: 'Super DT Company' }) },
    ]);

    const result = await resolveOrderCustomerBatch(salesUser, ['SUPERDT2-09']);

    expect(result.results[0]).toEqual(expect.objectContaining({
      success: true,
      orderNo: 'SUPERDT2-09',
      matchedBy: 'derived-order-name',
      derivedOrderName: 'SUPERDT2',
      customer: expect.objectContaining({
        id: 'customer-2',
        displayName: 'Super DT Company',
        mark: 'SDT 2',
      }),
    }));
  });

  it('returns per-order errors without failing the whole batch', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([makeLinkedOrder()])
      .mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

    const result = await resolveOrderCustomerBatch(salesUser, ['GANDO-10', 'MISSING-1']);

    expect(result.results).toEqual([
      expect.objectContaining({ success: true, orderNo: 'GANDO-10' }),
      expect.objectContaining({ success: false, orderNo: 'MISSING-1', code: 'EXCEL_ORDER_NOT_FOUND', status: 404 }),
    ]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_ORDER_LOOKUP',
      metadata: expect.objectContaining({ count: 2, successCount: 1, failureCount: 1 }),
    }));
  });
});
