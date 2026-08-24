import { db } from '@/lib/db';
import { getDashboardCustomerHistory, searchDashboardCustomers } from '@/lib/dashboard-customer-history-service';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { readCustomerHistory } from '@/lib/customer-history-service';
import {
  buildCustomerVisibilityWhere,
  buildOrderVisibilityWhere,
  buildReceiptVisibilityWhere,
  getOwnerVisibleIds,
} from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    customer: { findMany: jest.fn() },
    invoice: { findMany: jest.fn() },
    order: { findUnique: jest.fn() },
  },
}));

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAlias: jest.fn(),
}));

jest.mock('@/lib/customer-history-service', () => ({
  readCustomerHistory: jest.fn(),
}));

jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn(),
  buildCustomerVisibilityWhere: jest.fn(),
  buildOrderVisibilityWhere: jest.fn(),
  buildReceiptVisibilityWhere: jest.fn(),
}));

const mockCustomerFindMany = db.customer.findMany as jest.Mock;
const mockInvoiceFindMany = db.invoice.findMany as jest.Mock;
const mockOrderFindUnique = db.order.findUnique as jest.Mock;
const mockFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;
const mockReadCustomerHistory = readCustomerHistory as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;
const mockBuildCustomerVisibilityWhere = buildCustomerVisibilityWhere as jest.Mock;
const mockBuildOrderVisibilityWhere = buildOrderVisibilityWhere as jest.Mock;
const mockBuildReceiptVisibilityWhere = buildReceiptVisibilityWhere as jest.Mock;

const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'User',
  role: 'USER' as const,
  level: 4,
  parentId: 'sales-1',
  createdById: 'sales-1',
};

describe('searchDashboardCustomers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['user-1']);
    mockBuildCustomerVisibilityWhere.mockReturnValue({ receipts: { some: { createdBy: 'user-1' } } });
    mockBuildOrderVisibilityWhere.mockReturnValue({ createdBy: { in: ['user-1'] } });
    mockBuildReceiptVisibilityWhere.mockReturnValue({ createdBy: { in: ['user-1'] } });
    mockFindOrderIdByNoOrAlias.mockResolvedValue(null);
    mockOrderFindUnique.mockResolvedValue(null);
    mockInvoiceFindMany.mockResolvedValue([]);
  });

  it('returns every visible customer matched by exact MARK or ORDER_NAME and partial NAME', async () => {
    mockCustomerFindMany.mockResolvedValue([
      {
        id: 'customer-mark',
        mark: 'PIKIN',
        normalizedMark: 'pikin',
        orderName: 'PIKIN',
        name: 'Mamadou Dian Diallo',
        orderNames: [{ orderName: 'PIKIN', normalizedOrderName: 'pikin', isPrimary: true }],
      },
      {
        id: 'customer-name',
        mark: 'MD',
        normalizedMark: 'md',
        orderName: 'MDD',
        name: 'Mamadou Camara',
        orderNames: [{ orderName: 'MDD', normalizedOrderName: 'mdd', isPrimary: true }],
      },
    ]);

    const result = await searchDashboardCustomers(currentUser, 'Mamadou');

    expect(mockGetOwnerVisibleIds).toHaveBeenCalledWith(currentUser);
    expect(mockCustomerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          { receipts: { some: { createdBy: 'user-1' } } },
          expect.objectContaining({ OR: expect.any(Array) }),
        ],
      },
    }));
    expect(result.items).toEqual([
      {
        customerId: 'customer-name',
        mark: 'MD',
        name: 'Mamadou Camara',
        orderNames: ['MDD'],
      },
      {
        customerId: 'customer-mark',
        mark: 'PIKIN',
        name: 'Mamadou Dian Diallo',
        orderNames: ['PIKIN'],
      },
    ]);
  });

  it('uses the shared exact ORDER NO matcher and deduplicates the linked customer', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValue('order-1');
    mockOrderFindUnique.mockResolvedValue({ customerId: 'customer-1' });
    mockCustomerFindMany.mockResolvedValue([
      {
        id: 'customer-1',
        mark: 'PIKIN',
        normalizedMark: 'pikin',
        orderName: 'PIKIN',
        name: 'Mamadou Dian Diallo',
        orderNames: [
          { orderName: 'PIKIN', normalizedOrderName: 'pikin', isPrimary: true },
          { orderName: 'PIKIN OLD', normalizedOrderName: 'pikinold', isPrimary: false },
        ],
      },
    ]);

    const result = await searchDashboardCustomers(currentUser, 'PIKIN-19B');

    expect(mockFindOrderIdByNoOrAlias).toHaveBeenCalledWith('PIKIN-19B', { createdBy: { in: ['user-1'] } });
    expect(result.items).toEqual([
      {
        customerId: 'customer-1',
        mark: 'PIKIN',
        name: 'Mamadou Dian Diallo',
        orderNames: ['PIKIN', 'PIKIN OLD'],
      },
    ]);
  });

  it('rejects an empty search instead of returning the full customer list', async () => {
    await expect(searchDashboardCustomers(currentUser, '   ')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    });
    expect(mockCustomerFindMany).not.toHaveBeenCalled();
  });

  it('loads one customer history using visible orders and receipts for every role', async () => {
    mockReadCustomerHistory.mockResolvedValue({
      data: {
        customer: { id: 'customer-1', mark: 'PIKIN', name: 'Mamadou Dian Diallo' },
        orderNames: ['PIKIN', 'PIKIN OLD'],
        orders: [],
        receipts: [],
      },
    });
    mockInvoiceFindMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invNo: 'INV-001',
        releaseDate: new Date('2026-08-01T00:00:00.000Z'),
        orders: [{
          id: 'order-1',
          orderNo: 'PIKIN-20',
          customerId: 'customer-1',
          customerName: 'Mamadou Dian Diallo',
          customerMark: 'PIKIN',
          amount: 1000,
          orderBalance: 900,
          receipts: [{ usd: 250, status: 'RECEIVED' }],
        }],
      },
    ]);

    const result = await getDashboardCustomerHistory(currentUser, {
      customerId: 'customer-1',
      orderPage: 1,
      orderPageSize: 10,
      receiptPage: 1,
      receiptPageSize: 10,
    });

    expect(mockReadCustomerHistory).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-1',
      orderName: null,
      customerWhere: { receipts: { some: { createdBy: 'user-1' } } },
      orderWhere: { createdBy: { in: ['user-1'] } },
      receiptWhere: { createdBy: { in: ['user-1'] } },
    }));
    expect(result.data.orderNames).toEqual(['PIKIN', 'PIKIN OLD']);
    expect(mockInvoiceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        invNo: { notIn: ['Un_Associated', 'DEPOSIT_POOL'] },
      }),
    }));
    expect(result.data.outstanding).toMatchObject({
      customerId: 'customer-1',
      totalOutstanding: 750,
      statusSubtotals: { inTransit: 0, released: 750 },
    });
  });
});
