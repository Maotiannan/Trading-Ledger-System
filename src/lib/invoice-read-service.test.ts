import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import {
  listInvoiceRecords,
  lookupInvoiceOrderContext,
  listOrderMatchCandidates,
  listOrderReceiptRecords,
} from '@/lib/invoice-read-service';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: jest.fn(),
    },
    customerOrderName: {
      findMany: jest.fn(),
    },
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
  customer: { findMany: jest.Mock };
  customerOrderName: { findMany: jest.Mock };
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

  it('returns empty direct candidate list when alias resolves to a missing order', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('order-missing');
    mockDb.order.findUnique.mockResolvedValueOnce(null);

    const result = await listOrderMatchCandidates(makeUser() as never, 'IB-404');

    expect(result.data).toEqual([]);
    expect(result.message).toContain('0 条');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_MATCH_CANDIDATES_VIEW',
      targetId: 'order-missing',
      metadata: expect.objectContaining({ mode: 'direct', count: 0 }),
    }));
  });

  it('falls back to group key matching when alias lookup misses', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-1',
        orderNo: 'IB-01A',
        customerId: 'customer-1',
        customerMark: 'IB',
        customerName: 'IB',
        customerPhone: '622443103',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        createdAt: new Date('2026-03-12T00:00:00Z'),
      },
      {
        id: 'order-2',
        orderNo: 'XX-01',
        customerId: 'customer-2',
        customerMark: 'XX',
        customerName: 'XX',
        customerPhone: '620000000',
        customerCity: 'Kindia',
        needsCustomerFix: false,
        createdAt: new Date('2026-03-11T00:00:00Z'),
      },
    ]);

    const result = await listOrderMatchCandidates(makeUser() as never, 'IB-01B');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('order-1');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_MATCH_CANDIDATES_VIEW',
      metadata: expect.objectContaining({ mode: 'group-fallback', count: 1 }),
    }));
  });

  it('returns no candidates for invalid order group key', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce(null);

    const result = await listOrderMatchCandidates(makeUser() as never, '');

    expect(result.data).toEqual([]);
    expect(mockDb.order.findMany).not.toHaveBeenCalled();
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ mode: 'invalid-group-key', count: 0 }),
    }));
  });

  it('loads exact invoice order context and infers a unique customer by ORDER name', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-latest',
        orderNo: 'GANDO-07',
        customerId: 'customer-1',
        customerMark: 'KIGNA TEXTILE',
        customerName: 'GANDO',
        customerPhone: '622443103',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        createdAt: new Date('2026-03-12T00:00:00Z'),
        invoice: {
          id: 'inv-latest',
          invNo: 'INV-LATEST',
          createdAt: new Date('2026-03-12T00:00:00Z'),
        },
        customer: {
          id: 'customer-1',
          orderName: 'GANDO',
          companyName: 'KIGNA SARL',
          mark: 'KIGNA TEXTILE',
          name: 'Mamdaou Gando Diallo',
          phone: '622443103',
          city: 'Conakry',
        },
      },
      {
        id: 'order-old',
        orderNo: 'GANDO-07',
        customerId: 'customer-2',
        customerMark: 'OLD',
        customerName: 'GANDO',
        customerPhone: '620000000',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        createdAt: new Date('2026-03-11T00:00:00Z'),
        invoice: {
          id: 'inv-old',
          invNo: 'INV-OLD',
          createdAt: new Date('2026-03-11T00:00:00Z'),
        },
        customer: null,
      },
    ]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'GANDO',
        normalizedOrderName: 'gando',
        customer: {
          id: 'customer-1',
          mark: 'KIGNA TEXTILE',
          orderName: 'GANDO',
          phone: '622443103',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'GANDO-07');

    expect(result.data.exactMatches).toHaveLength(2);
    expect(result.data.exactMatches[0]).toEqual(expect.objectContaining({
      id: 'order-latest',
      customerPhone: '622443103',
      customerPayer: 'KIGNA SARL',
      invoice: expect.objectContaining({ invNo: 'INV-LATEST' }),
    }));
    expect(result.data.inferredCustomer).toEqual(expect.objectContaining({
      mark: 'KIGNA TEXTILE',
      orderName: 'GANDO',
    }));
    expect(result.data.derivedOrderName).toBe('GANDO');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_MATCH_CANDIDATES_VIEW',
      metadata: expect.objectContaining({
        mode: 'context',
        count: 2,
        inferredCustomer: true,
        derivedOrderName: 'GANDO',
      }),
    }));
  });

  it('falls back payer suggestion from customer name when company name is empty', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-latest',
        orderNo: 'TEST-2-01',
        customerId: 'customer-9',
        customerMark: 'TEST-2',
        customerName: 'Fallback Name',
        customerPhone: '620000999',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        createdAt: new Date('2026-04-30T00:00:00Z'),
        invoice: {
          id: 'inv-9',
          invNo: 'INV-TEST-2',
          createdAt: new Date('2026-04-30T00:00:00Z'),
        },
        customer: {
          id: 'customer-9',
          orderName: 'TEST-2',
          companyName: '',
          mark: 'TEST-2',
          name: 'Fallback Name',
          phone: '620000999',
          city: 'Conakry',
        },
      },
    ]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'TEST-2-01');

    expect(result.data.exactMatches[0]).toEqual(expect.objectContaining({
      customerPhone: '620000999',
      customerPayer: 'Fallback Name',
    }));
  });

  it('returns empty invoice order context for blank order input', async () => {
    const result = await lookupInvoiceOrderContext(makeUser() as never, '');

    expect(result.data).toEqual({
      exactMatches: [],
      inferredCustomer: null,
      derivedOrderName: null,
    });
    expect(mockDb.order.findMany).not.toHaveBeenCalled();
    expect(mockDb.customerOrderName.findMany).not.toHaveBeenCalled();
  });

  it('skips customer inference when ORDER cannot derive a left-side order name', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'GANDO');

    expect(result.data.exactMatches).toEqual([]);
    expect(result.data.inferredCustomer).toBeNull();
    expect(result.data.derivedOrderName).toBeNull();
    expect(mockDb.customerOrderName.findMany).not.toHaveBeenCalled();
  });

  it('does not infer a customer when ORDER-derived name matches multiple customers', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'GANDO',
        normalizedOrderName: 'gando',
        customer: {
          id: 'customer-1',
          mark: 'MARK-1',
          orderName: 'GANDO',
          phone: '620000001',
          city: 'Conakry',
        },
      },
      {
        orderName: 'GANDO',
        normalizedOrderName: 'gando',
        customer: {
          id: 'customer-2',
          mark: 'MARK-2',
          orderName: 'GANDO',
          phone: '620000002',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'GANDO-07');

    expect(result.data.exactMatches).toEqual([]);
    expect(result.data.inferredCustomer).toBeNull();
    expect(result.data.derivedOrderName).toBe('GANDO');
  });

  it('infers a customer by ORDER_NAME while ignoring spaces', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'SUPER DT 2',
        normalizedOrderName: 'superdt2',
        customer: {
          id: 'customer-3',
          mark: 'SDT 2',
          orderName: 'SUPER DT 2',
          phone: '620000003',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'S U P E R D T 2 -09');

    expect(result.data.inferredCustomer).toEqual(expect.objectContaining({
      id: 'customer-3',
      mark: 'SDT 2',
      orderName: 'SUPER DT 2',
      phone: '620000003',
    }));
    expect(result.data.derivedOrderName).toBe('S U P E R D T 2');
  });

  it('returns accessible order receipts and records count', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({ id: 'order-1' });
    mockDb.receipt.findMany.mockResolvedValueOnce([
      {
        id: 'receipt-1',
        receiptNo: 'RCPT-1',
        usd: 100,
        status: 'Waiting_SWIFT',
        date: '2026-03-12',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        payer: 'Alice',
        invNo: 'INV-1',
        orderNo: 'IB-01',
      },
    ]);

    const result = await listOrderReceiptRecords(makeUser() as never, 'order-1');

    expect(result.data).toHaveLength(1);
    expect(result.message).toContain('1 条');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_RECEIPT_LIST_VIEW',
      targetId: 'order-1',
      metadata: expect.objectContaining({ accessible: true, count: 1 }),
    }));
  });

  it('computes invoice balances from linked orders and receipts', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-1',
        invNo: 'INV-001',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        orders: [
          {
            id: 'order-1',
            orderNo: 'IB-01',
            amount: 100,
            receipts: [{ usd: 30, status: 'Waiting_SWIFT' }, { usd: 20, status: 'RECEIVED' }],
          },
          {
            id: 'order-2',
            orderNo: 'IB-02',
            amount: 50,
            receipts: [],
          },
        ],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
    ]);

    const result = await listInvoiceRecords(makeUser() as never, '');

    expect(result.data).toEqual([
      expect.objectContaining({
        invNo: 'INV-001',
        invAmount: 150,
        invBalance: 100,
        orders: [
          expect.objectContaining({ orderNo: 'IB-01', orderBalance: 50, isSystemOrder: false }),
          expect.objectContaining({ orderNo: 'IB-02', orderBalance: 50, isSystemOrder: false }),
        ],
      }),
    ]);
  });

  it('sorts Un_Associated ahead of normal invoices but after DEPOSIT_POOL', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-3',
        invNo: 'INV-001',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
      {
        id: 'inv-2',
        invNo: 'Un_Associated',
        createdAt: new Date('2026-03-13T00:00:00Z'),
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

    expect(result.data.map((row) => row.invNo)).toEqual(['DEPOSIT_POOL', 'Un_Associated', 'INV-001']);
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

  it('filters invoices by search term before returning list', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-1',
        invNo: 'INV-IB-001',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
      {
        id: 'inv-2',
        invNo: 'INV-XX-002',
        createdAt: new Date('2026-03-11T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
    ]);

    const result = await listInvoiceRecords(makeUser() as never, 'IB-001');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].invNo).toBe('INV-IB-001');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ count: 1, search: 'IB-001' }),
    }));
  });

  it('sorts normal invoices by createdAt descending when ranks match', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([
      {
        id: 'inv-2',
        invNo: 'INV-002',
        createdAt: new Date('2026-03-11T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
      {
        id: 'inv-1',
        invNo: 'INV-001',
        createdAt: new Date('2026-03-12T00:00:00Z'),
        orders: [],
        creator: { id: 'sales-1', name: 'Sales', email: 'sales@example.com' },
      },
    ]);

    const result = await listInvoiceRecords(makeUser() as never, '');

    expect(result.data.map((row) => row.invNo)).toEqual(['INV-001', 'INV-002']);
  });
});
