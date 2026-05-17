import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { resolveCustomer } from '@/lib/customer-matching';
import { listCustomerFixQueue } from '@/lib/customer-fix-read-service';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/audit', () => ({
  recordAuditEvent: jest.fn(),
}));

jest.mock('@/lib/customer-matching', () => ({
  resolveCustomer: jest.fn(),
}));

const mockDb = db as unknown as {
  order: { findMany: jest.Mock; update: jest.Mock };
  receipt: { findMany: jest.Mock; update: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockResolveCustomer = resolveCustomer as jest.Mock;

function makeUser() {
  return {
    id: 'sales-1',
    email: 'sales@example.com',
    name: 'Sales',
    role: UserRole.SALES,
    level: 3,
    parentId: 'admin-1',
    createdById: 'admin-1',
  };
}

describe('customer-fix-read-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCustomer.mockResolvedValue({
      customerId: null,
      customerMark: '',
      customerName: null,
      customerPayerName: null,
      customerPhone: null,
      customerCity: null,
      needsCustomerFix: true,
      matchedBy: 'none',
      candidateCount: 0,
    });
  });

  it('lists customer fix queue and records audit', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([{ id: 'order-1', orderNo: 'FIX-01' }]);
    mockDb.receipt.findMany.mockResolvedValueOnce([{ id: 'receipt-1', orderNo: 'FIX-01' }]);

    const result = await listCustomerFixQueue(makeUser());

    expect(result.data.orders).toHaveLength(1);
    expect(result.data.receipts).toHaveLength(1);
    expect(mockDb.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdBy: 'sales-1' }),
    }));
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CUSTOMER_FIX_QUEUE_VIEW',
      metadata: expect.objectContaining({ orderCount: 1, receiptCount: 1 }),
    }));
  });

  it('auto-clears stale fix rows when their source now resolves to an existing customer', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([
        {
          id: 'order-1',
          orderNo: 'FIX-01',
          customerMark: 'FIX',
          customerName: 'FIX',
          customerId: null,
        },
      ])
      .mockResolvedValueOnce([]);
    mockDb.receipt.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockResolveCustomer.mockResolvedValueOnce({
      customerId: 'customer-1',
      customerMark: 'FIX',
      customerName: 'FIX',
      customerPayerName: 'Fix Customer',
      customerPhone: '620000000',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      matchedBy: 'name',
      candidateCount: 1,
    });

    const result = await listCustomerFixQueue(makeUser());

    expect(mockDb.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        customerId: 'customer-1',
        customerMark: 'FIX',
        needsCustomerFix: false,
      }),
    });
    expect(result.data.orders).toEqual([]);
  });
});
