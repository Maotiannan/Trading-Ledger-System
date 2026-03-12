import { UserRole } from '@prisma/client';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { listCustomerFixQueue } from '@/lib/customer-fix-read-service';

jest.mock('@/lib/db', () => ({
  db: {
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

const mockDb = db as unknown as {
  order: { findMany: jest.Mock };
  receipt: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;

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
});
