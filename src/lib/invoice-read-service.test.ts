import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import {
  listInvoiceRecords,
  listOrderMatchCandidates,
  listOrderReceiptRecords,
} from '@/lib/invoice-read-service';

jest.mock('@/lib/db', () => ({
  db: {
    order: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    receipt: {
      findMany: jest.fn(),
    },
    invoice: {
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

jest.mock('@/lib/order-alias-db', () => ({
  findOrderIdByNoOrAlias: jest.fn(),
}));

const mockDb = db as unknown as {
  order: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  receipt: { findMany: jest.Mock };
  invoice: { findMany: jest.Mock };
};
const mockRecordAuditEvent = recordAuditEvent as jest.Mock;
const mockGetHierarchyScope = getHierarchyScope as jest.Mock;
const mockFindOrderIdByNoOrAlias = findOrderIdByNoOrAlias as jest.Mock;

function makeUser() {
  return {
    id: 'sales-1',
    email: 'sales@example.com',
    name: 'Sales',
    role: 'SALES',
    level: 3,
    parentId: 'admin-1',
    createdById: 'admin-1',
  };
}

describe('invoice-read-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHierarchyScope.mockResolvedValue({ ownerVisibleIds: new Set(['sales-1']) });
  });

  it('returns empty receipt list when order is not accessible', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce(null);

    const result = await listOrderReceiptRecords(makeUser() as never, 'order-1');

    expect(result.data).toEqual([]);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_RECEIPT_LIST_VIEW',
      targetId: 'order-1',
      metadata: expect.objectContaining({ accessible: false, count: 0 }),
    }));
  });

  it('returns direct order match candidate and records audit', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('order-1');
    mockDb.order.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'IB-01',
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '622443103',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      createdAt: new Date('2026-03-12T00:00:00Z'),
    });

    const result = await listOrderMatchCandidates(makeUser() as never, 'IB-01');

    expect(result.data).toHaveLength(1);
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_MATCH_CANDIDATES_VIEW',
      metadata: expect.objectContaining({ mode: 'direct', count: 1 }),
    }));
  });

  it('sorts DEPOSIT_POOL before normal invoices', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-2',
        invNo: 'INV-001',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
      {
        id: 'inv-1',
        invNo: 'DEPOSIT_POOL',
        createdAt: new Date('2026-03-11T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
    ]);

    const result = await listInvoiceRecords(makeUser() as never, '');

    expect(result.data[0].invNo).toBe('DEPOSIT_POOL');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVOICE_LIST_VIEW',
      metadata: expect.objectContaining({ count: 2 }),
    }));
  });
});
