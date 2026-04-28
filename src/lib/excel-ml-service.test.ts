import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import {
  EXCEL_ML_FIELDS,
  resolveExcelMlBatch,
  resolveExcelMlValue,
} from '@/lib/excel-ml-service';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: jest.fn(),
    },
    customer: {
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
  customer: { findMany: jest.Mock };
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
    orderName: 'GANDO',
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
    customerId: 'customer-1',
    createdAt: new Date('2026-04-28T08:00:00.000Z'),
    invoice: { id: 'invoice-1', invNo: 'INV-1', createdAt: new Date('2026-04-28T08:00:00.000Z') },
    customer: makeCustomer(),
    ...overrides,
  };
}

describe('excel-ml-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHierarchyScope.mockResolvedValue({ ownerVisibleIds: new Set(['sales-1']) });
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.customer.findMany.mockResolvedValue([]);
  });

  it('publishes the approved field catalog', () => {
    expect(EXCEL_ML_FIELDS.map((field) => [field.index, field.key])).toEqual([
      [1, 'ORDER_NAME'],
      [2, 'DISPLAY_NAME'],
      [3, 'MARK'],
      [4, 'CUSTOMER_NAME'],
      [5, 'COMPANY_NAME'],
      [6, 'PHONE'],
      [7, 'CITY'],
      [8, 'CONSIGNEE'],
      [9, 'COMPANY_ADDRESS'],
      [10, 'CREDIT'],
      [11, 'CUSTOMER_ID'],
    ]);
  });

  it('returns ORDER_NAME for field 1 after deriving it from order number', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([makeCustomer()]);

    const result = await resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 1 });

    expect(result).toEqual(expect.objectContaining({
      orderNo: 'GANDO-10',
      derivedOrderName: 'GANDO',
      field: 1,
      fieldKey: 'ORDER_NAME',
      value: 'GANDO',
      matchedBy: 'derived-order-name',
      customerId: 'customer-1',
    }));
    expect(mockDb.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerId: { in: ['sales-1'] },
        orderName: { equals: 'GANDO' },
      },
    }));
  });

  it('returns company name with customer name fallback for field 2', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      makeCustomer({ companyName: '', name: 'Gando Customer' }),
    ]);

    const result = await resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 2 });

    expect(result.value).toBe('Gando Customer');
    expect(result.fieldKey).toBe('DISPLAY_NAME');
  });

  it('returns MARK for field 3', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      makeCustomer({ mark: 'MK-88' }),
    ]);

    const result = await resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 3 });

    expect(result.value).toBe('MK-88');
    expect(result.fieldKey).toBe('MARK');
  });

  it('prefers a unique linked customer from existing visible order matches', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([makeLinkedOrder()]);

    const result = await resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 5 });

    expect(result.value).toBe('Gando LLC');
    expect(result.matchedBy).toBe('linked-order');
    expect(mockDb.customer.findMany).not.toHaveBeenCalled();
  });

  it('rejects ambiguous linked order customers instead of guessing', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      makeLinkedOrder({ id: 'order-1', customer: makeCustomer({ id: 'customer-1' }) }),
      makeLinkedOrder({ id: 'order-2', customer: makeCustomer({ id: 'customer-2' }) }),
    ]);

    await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 2 })).rejects.toMatchObject({
      code: 'EXCEL_ORDER_CONFLICT',
      status: 409,
    });
  });

  it('rejects ambiguous derived customer matches', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      makeCustomer({ id: 'customer-1' }),
      makeCustomer({ id: 'customer-2' }),
    ]);

    await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 2 })).rejects.toMatchObject({
      code: 'EXCEL_ORDER_CONFLICT',
      status: 409,
    });
  });

  it('rejects invalid fields and unmatched order numbers', async () => {
    await expect(resolveExcelMlValue(salesUser, { orderNo: 'GANDO-10', field: 99 })).rejects.toMatchObject({
      code: 'EXCEL_FIELD_INVALID',
      status: 400,
    });

    await expect(resolveExcelMlValue(salesUser, { orderNo: 'NO-DASH', field: 1 })).rejects.toMatchObject({
      code: 'EXCEL_ORDER_NOT_FOUND',
      status: 404,
    });
  });

  it('returns per-row results for batch lookups', async () => {
    mockDb.customer.findMany
      .mockResolvedValueOnce([makeCustomer()])
      .mockResolvedValueOnce([makeCustomer({ companyName: '', name: 'Gando Customer' })])
      .mockResolvedValueOnce([]);

    const result = await resolveExcelMlBatch(salesUser, [
      { orderNo: 'GANDO-10', field: 1 },
      { orderNo: 'GANDO-10', field: 2 },
      { orderNo: 'MISSING-1', field: 1 },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ success: true, value: 'GANDO' }),
      expect.objectContaining({ success: true, value: 'Gando Customer' }),
      expect.objectContaining({ success: false, code: 'EXCEL_ORDER_NOT_FOUND' }),
    ]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXCEL_ML_BATCH_LOOKUP',
      metadata: expect.objectContaining({ count: 3, successCount: 2, failureCount: 1 }),
    }));
  });
});
