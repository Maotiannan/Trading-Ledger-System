import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getSystemSettings } from '@/lib/system-settings';
import {
  assertNoCustomerScopeConflict,
  mapPrismaWriteError,
  resolveCustomerOwnerId,
  resolveCustomerUpsertTargetId,
} from '@/lib/customer-scope';
import {
  parseFixCustomerPayload,
  resolveOrderCustomerFix,
  resolveReceiptCustomerFix,
} from '@/lib/customer-fix-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      create: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    receipt: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
  mapPrismaWriteError: jest.fn((error: unknown) => error instanceof Error ? error.message : '数据库错误'),
  resolveCustomerOwnerId: jest.fn(),
  resolveCustomerUpsertTargetId: jest.fn(),
}));

function makeUser(overrides: Partial<{
  id: string;
  role: UserRole;
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
  customer: { create: jest.Mock; update: jest.Mock };
  order: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock; findMany: jest.Mock };
  receipt: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};

const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetSystemSettings = getSystemSettings as jest.Mock;
const mockResolveCustomerOwnerId = resolveCustomerOwnerId as jest.Mock;
const mockResolveCustomerUpsertTargetId = resolveCustomerUpsertTargetId as jest.Mock;
const mockAssertNoCustomerScopeConflict = assertNoCustomerScopeConflict as jest.Mock;
const mockMapPrismaWriteError = mapPrismaWriteError as jest.Mock;

describe('customer-fix-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(mockDb));
    mockGetSystemSettings.mockResolvedValue({ SALES_CAN_VIEW_EXTENDED_CUSTOMER_FIELDS: 'true' });
    mockResolveCustomerOwnerId.mockResolvedValue('sales-1');
    mockResolveCustomerUpsertTargetId.mockResolvedValue(null);
    mockAssertNoCustomerScopeConflict.mockResolvedValue(undefined);
  });

  it('parses fix payload and validates required fields', () => {
    expect(parseFixCustomerPayload({ mark: '', orderName: '', name: '', phone: '', city: '' })).toEqual({
      error: 'MARK/ORDER_NAME/NAME/PHONE/CITY均为必填',
    });
  });

  it('rejects negative credit in fix payload', () => {
    expect(parseFixCustomerPayload({
      mark: 'IB',
      orderName: 'IB',
      name: 'Ibrahima',
      phone: '622443103',
      city: 'Conakry',
      credit: -1,
    })).toEqual({
      error: 'CREDIT必须为大于等于0的数字',
    });
  });

  it('resolves order customer fix in transaction and records audit', async () => {
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-1', createdBy: 'sales-1', orderNo: 'IB-01' });
    mockDb.customer.create.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB',
      name: 'Ibrahima',
      orderName: 'IB',
      phone: '622443103',
      city: 'Conakry',
    });
    mockDb.order.update.mockResolvedValueOnce({ orderNo: 'IB-01' });
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', orderNo: 'IB-01' }]);
    mockDb.order.updateMany.mockResolvedValueOnce({ count: 1 });
    mockDb.receipt.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);

    const result = await resolveOrderCustomerFix(makeUser({ role: UserRole.SALES, id: 'sales-1' }), {
      orderId: 'order-1',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    });

    expect(result.message).toBe('订单客户信息已修复');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_FIX_ORDER',
      targetId: 'order-1',
    }));
  });

  it('resolves receipt customer fix and syncs linked order', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce({ id: 'receipt-1', createdBy: 'sales-1', orderId: 'order-1', orderNo: 'IB-01' });
    mockDb.customer.create.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB',
      name: 'Ibrahima',
      orderName: 'IB',
      phone: '622443103',
      city: 'Conakry',
    });
    mockDb.receipt.update.mockResolvedValueOnce({ orderId: 'order-1', orderNo: 'IB-01' });
    mockDb.order.update.mockResolvedValueOnce({ id: 'order-1' });
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', orderNo: 'IB-01' }]);
    mockDb.order.updateMany.mockResolvedValueOnce({ count: 1 });
    mockDb.receipt.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);

    const result = await resolveReceiptCustomerFix(makeUser({ role: UserRole.SALES, id: 'sales-1' }), {
      receiptId: 'receipt-1',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    });

    expect(result.message).toBe('收据客户信息已修复');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_FIX_RECEIPT',
      targetId: 'receipt-1',
    }));
  });

  it('forbids sales from fixing another sales order', async () => {
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-1', createdBy: 'sales-2', orderNo: 'IB-01' });

    await expect(resolveOrderCustomerFix(makeUser({ role: UserRole.SALES, id: 'sales-1' }), {
      orderId: 'order-1',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    })).rejects.toMatchObject({
      code: 'CUSTOMER_SCOPE_FORBIDDEN',
      status: 403,
      message: '无权修复该订单',
    });
  });

  it('rejects missing receipt during receipt fix', async () => {
    mockDb.receipt.findUnique.mockResolvedValueOnce(null);

    await expect(resolveReceiptCustomerFix(makeUser(), {
      receiptId: 'missing',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
      message: '收据不存在',
    });
  });

  it('updates existing customer instead of creating a new one when scoped match exists', async () => {
    mockResolveCustomerUpsertTargetId.mockResolvedValueOnce('customer-1');
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-1', createdBy: 'sales-1', orderNo: 'IB-01' });
    mockDb.customer.update.mockResolvedValueOnce({
      id: 'customer-1',
      mark: 'IB',
      name: 'Ibrahima',
      orderName: 'IB',
      phone: '622443103',
      city: 'Conakry',
    });
    mockDb.order.update.mockResolvedValueOnce({ orderNo: 'IB-01' });
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', orderNo: 'IB-01' }]);
    mockDb.order.updateMany.mockResolvedValueOnce({ count: 1 });
    mockDb.receipt.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    mockDb.receipt.findMany.mockResolvedValueOnce([]);

    const result = await resolveOrderCustomerFix(makeUser({ role: UserRole.SALES, id: 'sales-1' }), {
      orderId: 'order-1',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    });

    expect(result.data.id).toBe('customer-1');
    expect(mockDb.customer.create).not.toHaveBeenCalled();
    expect(mockDb.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'customer-1' },
    }));
  });

  it('maps unexpected transaction errors to structured api errors', async () => {
    mockDb.order.findUnique.mockResolvedValueOnce({ id: 'order-1', createdBy: 'sales-1', orderNo: 'IB-01' });
    mockDb.$transaction.mockImplementationOnce(async () => {
      throw new Error('db fail');
    });
    mockMapPrismaWriteError.mockReturnValueOnce('db fail');

    await expect(resolveOrderCustomerFix(makeUser({ role: UserRole.SALES, id: 'sales-1' }), {
      orderId: 'order-1',
      ownerId: 'sales-1',
      payload: {
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        city: 'Conakry',
        consignee: null,
        companyName: null,
        companyAddress: null,
        credit: null,
      },
    })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
      message: 'db fail',
    });
  });
});
