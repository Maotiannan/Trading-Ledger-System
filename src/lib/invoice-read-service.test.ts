import { db } from '@/lib/db';
import { recordAuditEvent } from '@/lib/audit';
import { getHierarchyScope } from '@/lib/user-hierarchy';
import { findOrderIdByNoOrAlias } from '@/lib/order-alias-db';
import { loadDepositPool } from '@/lib/prepayments/pool-read-service';
import { readInvoiceSourceMetadata } from '@/lib/integrations/mucont-invoice-metadata';
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
      count: jest.fn(),
    },
    prepaymentAllocation: { findMany: jest.fn() },
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
jest.mock('@/lib/prepayments/pool-read-service', () => ({
  loadDepositPool: jest.fn().mockResolvedValue({ rows: [], availableTotal: '0.00', reservedTotal: '0.00', heldTotal: '0.00' }),
}));
jest.mock('@/lib/integrations/mucont-invoice-metadata', () => ({
  sourceDateFields: jest.requireActual('@/lib/integrations/mucont-invoice-metadata').sourceDateFields,
  readInvoiceSourceMetadata: jest.fn().mockResolvedValue(new Map()),
}));

const mockDb = db as unknown as {
  customer: { findMany: jest.Mock };
  customerOrderName: { findMany: jest.Mock };
  order: { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  receipt: { findMany: jest.Mock; count: jest.Mock };
  prepaymentAllocation: { findMany: jest.Mock };
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
    mockDb.prepaymentAllocation.findMany.mockResolvedValue([]);
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

  describe('invoice credit insurance', () => {
    const row = (id: string, managedById: string | null, count = 0) => ({
      id, invNo: id, createdBy: 'previous', managedById, createdAt: new Date(), _count: { orders: count },
      orders: [], mucontSource: { generationId: 'g', publicationSequence: 1 },
    });
    const insured = (id: string | null) => ({ availability: 'available', stale: false, metadata: {
      departureDate: '2026-11-01', creditInsurance: { creditRecordId: id, companyName: 'Private legal title' },
    } });
    it('batches distinct permitted titles, uses only the selected primary name and never reuses a grant on another invoice', async () => {
      const rows = [row('one', 'branch'), row('two', 'branch'), row('other', 'sibling'), row('partial', 'branch', 1),
        row('unassigned', null), row('legacy', 'branch'), row('missing', 'branch'), row('blank', 'branch')];
      mockDb.invoice.findMany.mockResolvedValueOnce(rows);
      mockGetHierarchyScope.mockResolvedValueOnce({ ownerVisibleIds: new Set(['root', 'branch', 'previous']) });
      (readInvoiceSourceMetadata as jest.Mock).mockResolvedValueOnce(new Map(rows.map(r => [
        r.id, insured(r.id === 'legacy' ? null : ['missing', 'blank'].includes(r.id) ? r.id : 'insured'),
      ])));
      mockDb.customer.findMany.mockResolvedValueOnce([{ id: 'insured', orderName: 'INSURED SHORT' }, { id: 'blank', orderName: ' ' }]);
      const { data } = await listInvoiceRecords({ ...makeUser(), id: 'root', role: 'ADMIN' } as never, '');
      expect(mockDb.customer.findMany).toHaveBeenCalledTimes(1);
      expect(mockDb.customer.findMany).toHaveBeenCalledWith({ where: { id: { in: ['insured', 'missing', 'blank'] } },
        select: { id: true, orderName: true } });
      for (const r of data) {
        if (['one', 'two', 'unassigned'].includes(r.id)) expect(r).toHaveProperty('source.creditInsurance', 'INSURED SHORT');
        else expect(r).not.toHaveProperty('source.creditInsurance');
      }
      expect(JSON.stringify(data)).not.toContain('Private legal title');
    });
    it.each([
      ['USER', 'branch', ['branch']], ['SALES', 'branch', ['branch']],
      ['ADMIN', 'previous', ['previous']], ['ADMIN', 'sibling', ['sibling']],
    ] as const)('does not expose or resolve the title for %s %s even with a fully visible invoice', async (role, id, visible) => {
      mockDb.invoice.findMany.mockResolvedValueOnce([row('invoice', 'branch')]);
      mockGetHierarchyScope.mockResolvedValueOnce({ ownerVisibleIds: new Set(visible) });
      (readInvoiceSourceMetadata as jest.Mock).mockResolvedValueOnce(new Map([['invoice', insured('insured')]]));
      const { data } = await listInvoiceRecords({ ...makeUser(), role, id } as never, 'Private legal title');
      expect(data).toEqual([]);
      expect(mockDb.customer.findMany).not.toHaveBeenCalled();
    });
  });

  it('checks full access and revision against retained groups but only displays active orders', async () => {
    mockDb.invoice.findMany.mockResolvedValueOnce([{
      id: 'invoice', invNo: 'INV', createdBy: 'sales-1', createdAt: new Date(), _count: { orders: 2 },
      mucontSource: { generationId: 'gen', publicationSequence: 2 }, orders: [
        { id: 'active', orderNo: 'A', customerId: 'a', amount: 100, createdBy: 'sales-1', canceledAt: null, receipts: [] },
        { id: 'canceled', orderNo: 'B', customerId: 'b', amount: 0, createdBy: 'sales-1', canceledAt: new Date(), receipts: [] },
      ],
    }]);
    const result = await listInvoiceRecords({ ...makeUser(), role: 'ADMIN' } as never, '');
    expect(mockDb.invoice.findMany.mock.calls[0][0].include.orders.where).not.toHaveProperty('canceledAt');
    expect(result.data[0]).toMatchObject({ invAmount: 100, source: { canResync: true, revision: expect.any(String) } });
    expect(result.data[0].orders.map(row => row.id)).toEqual(['active']);
  });

  it('returns direct order match candidate and records audit', async () => {
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('order-1');
    mockDb.order.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      orderNo: 'QZ-01',
      customerId: 'customer-1',
      customerMark: 'IB',
      customerName: 'IB',
      customerPhone: '622443103',
      customerCity: 'Conakry',
      needsCustomerFix: false,
      createdAt: new Date('2026-03-12T00:00:00Z'),
    });

    const result = await listOrderMatchCandidates(makeUser() as never, 'QZ-01');

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
        orderNo: 'QZ-01A',
        amount: 100,
        receipts: [{ usd: 40, status: 'RECEIVED', funding: { id: 'fund-1' } }],
        paymentAllocations: [{ amount: 15, funding: { active: true, receipt: { status: 'RECEIVED' } } }],
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

    const result = await listOrderMatchCandidates(makeUser() as never, 'QZ-01B');

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 'order-1', orderBalance: 85 });
    expect(result.data[0]).toHaveProperty('receipts', [{ usd: 40, status: 'RECEIVED' }]);
    expect(result.data[0]).not.toHaveProperty('paymentAllocations');
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
        orderNo: 'ORBIT-07',
        customerId: 'customer-1',
        customerMark: 'KIGNA TEXTILE',
        customerName: 'ORBIT',
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
          orderName: 'ORBIT',
          companyName: 'KIGNA SARL',
          mark: 'KIGNA TEXTILE',
          name: 'Mamdaou Orbit Diallo',
          phone: '622443103',
          city: 'Conakry',
        },
      },
      {
        id: 'order-old',
        orderNo: 'ORBIT-07',
        customerId: 'customer-2',
        customerMark: 'OLD',
        customerName: 'ORBIT',
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
        orderName: 'ORBIT',
        normalizedOrderName: 'orbit',
        customer: {
          id: 'customer-1',
          mark: 'KIGNA TEXTILE',
          orderName: 'ORBIT',
          phone: '622443103',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'ORBIT-07');

    expect(result.data.exactMatches).toHaveLength(2);
    expect(result.data.exactMatches[0]).toEqual(expect.objectContaining({
      id: 'order-latest',
      customerPhone: '622443103',
      customerPayer: 'KIGNA SARL',
      invoice: expect.objectContaining({ invNo: 'INV-LATEST' }),
    }));
    expect(result.data.inferredCustomer).toEqual(expect.objectContaining({
      mark: 'KIGNA TEXTILE',
      orderName: 'ORBIT',
    }));
    expect(result.data.derivedOrderName).toBe('ORBIT');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ORDER_MATCH_CANDIDATES_VIEW',
      metadata: expect.objectContaining({
        mode: 'context',
        count: 2,
        inferredCustomer: true,
        derivedOrderName: 'ORBIT',
      }),
    }));
  });

  it('computes exact order context balance from attached receipts instead of stale stored balance', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-kitem',
        orderNo: 'KITEM-19_B/KITEM-19B/KITEM-21',
        amount: 20088,
        orderBalance: 17869,
        receipts: [
          { usd: 500, status: 'RECEIVED' },
          { usd: 1719, status: 'SR_Received' },
          { usd: 14000, status: 'Bank_Transfer' },
          { usd: 900, status: 'SIGNING_PENDING' },
        ],
        customerId: 'customer-kitem',
        customerMark: 'KITEM',
        customerName: 'KITEM',
        customerPhone: '622491286',
        customerCity: 'Conakry',
        needsCustomerFix: false,
        createdAt: new Date('2026-05-07T00:00:00Z'),
        invoice: {
          id: 'inv-kitem',
          invNo: 'L25MH071089B',
          createdAt: new Date('2026-05-07T00:00:00Z'),
        },
        customer: {
          id: 'customer-kitem',
          orderName: 'KITEM',
          companyName: null,
          mark: 'KITEM',
          name: 'Mamadou Dian Diallo',
          phone: '622491286',
          city: 'Conakry',
        },
      },
    ]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'KITEM-19_B/KITEM-19B/KITEM-21');

    expect(mockDb.order.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      select: expect.objectContaining({
        amount: true,
        receipts: {
          where: { status: { not: 'SIGNING_PENDING' } },
          select: { usd: true, status: true, funding: { select: { id: true } } },
        },
      }),
    }));
    expect(result.data.exactMatches[0]).toEqual(expect.objectContaining({
      orderNo: 'KITEM-19_B/KITEM-19B/KITEM-21',
      orderBalance: 3869,
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

  it('returns no inferred customer when raw ORDER candidates also miss', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'ORBIT');

    expect(result.data.exactMatches).toEqual([]);
    expect(result.data.inferredCustomer).toBeNull();
    expect(result.data.derivedOrderName).toBeNull();
    expect(mockDb.customerOrderName.findMany).toHaveBeenCalled();
  });

  it('does not infer a customer when ORDER-derived name matches multiple customers', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'ORBIT',
        normalizedOrderName: 'orbit',
        customer: {
          id: 'customer-1',
          mark: 'MARK-1',
          orderName: 'ORBIT',
          phone: '620000001',
          city: 'Conakry',
        },
      },
      {
        orderName: 'ORBIT',
        normalizedOrderName: 'orbit',
        customer: {
          id: 'customer-2',
          mark: 'MARK-2',
          orderName: 'ORBIT',
          phone: '620000002',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'ORBIT-07');

    expect(result.data.exactMatches).toEqual([]);
    expect(result.data.inferredCustomer).toBeNull();
    expect(result.data.derivedOrderName).toBe('ORBIT');
  });

  it('infers a customer by ORDER_NAME while ignoring spaces', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'SUPER DT 2',
        normalizedOrderName: 'demofx2',
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

  it('infers a customer from any slash-delimited ORDER segment when exact rows are absent', async () => {
    mockDb.order.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'KITEM-23',
        normalizedOrderName: 'kitem-23',
        customer: {
          id: 'customer-9',
          mark: 'KITEM',
          orderName: 'KITEM-23',
          phone: '620000009',
          city: 'Conakry',
        },
      },
    ]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'KITEM-23/KITEM-19C');

    expect(result.data.inferredCustomer).toEqual(expect.objectContaining({
      id: 'customer-9',
      mark: 'KITEM',
      orderName: 'KITEM-23',
      phone: '620000009',
    }));
    expect(result.data.derivedOrderName).toBe('KITEM');
  });

  it('falls back to exact composite order lookup when alias rows are stale', async () => {
    mockDb.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'order-composite',
          orderNo: 'KITEM-23/KITEM-19C',
          customerId: 'customer-10',
          customerMark: 'KITEM',
          customerName: 'KITEM-23',
          customerPhone: '620000010',
          customerCity: 'Conakry',
          needsCustomerFix: false,
          createdAt: new Date('2026-05-05T00:00:00Z'),
          invoice: {
            id: 'inv-composite',
            invNo: 'INV-KITEM',
            createdAt: new Date('2026-05-05T00:00:00Z'),
          },
          customer: {
            id: 'customer-10',
            orderName: 'KITEM-23',
            companyName: 'Kitem SARL',
            mark: 'KITEM',
            name: 'Kitem Customer',
            phone: '620000010',
            city: 'Conakry',
          },
        },
      ]);
    mockFindOrderIdByNoOrAlias.mockResolvedValueOnce('order-composite');
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([]);

    const result = await lookupInvoiceOrderContext(makeUser() as never, 'KITEM-23');

    expect(mockFindOrderIdByNoOrAlias).toHaveBeenCalledWith('KITEM-23', expect.any(Object));
    expect(result.data.exactMatches).toHaveLength(1);
    expect(result.data.exactMatches[0]).toEqual(expect.objectContaining({
      id: 'order-composite',
      orderNo: 'KITEM-23/KITEM-19C',
      customerPayer: 'Kitem SARL',
      invoice: expect.objectContaining({ invNo: 'INV-KITEM' }),
    }));
  });

  it('returns accessible order receipts and records count', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({ id: 'order-1' });
    mockDb.receipt.count.mockResolvedValueOnce(1);
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
        orderNo: 'QZ-01',
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

  it('includes an allocated original receipt once and shows only this order contribution', async () => {
    mockDb.order.findFirst.mockResolvedValueOnce({ id: 'target-order' });
    mockDb.receipt.count.mockResolvedValueOnce(0);
    mockDb.receipt.findMany.mockImplementation(async ({ where }) => where.orderId ? [] : [{
      id: 'original-receipt', receiptNo: '0077001', usd: 3000, orderId: 'pool-order',
      status: 'RECEIVED', date: new Date('2026-06-02'), createdAt: new Date('2026-06-02'),
      payer: 'DEMOPAY', imageUrl: '/original.png', funding: { id: 'funding' },
    }]);
    mockDb.prepaymentAllocation.findMany.mockResolvedValueOnce([500, 1500].map((amount, index) => ({
      id: `allocation-${index}`, orderId: 'target-order', state: 'APPLIED', amount, appliedAt: new Date('2026-11-10'),
      funding: { id: 'funding', active: true, originalReceiptId: 'original-receipt', receipt: { status: 'RECEIVED' } },
    })));

    const result = await listOrderReceiptRecords(makeUser() as never, 'target-order');

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ receiptNo: '0077001', originalReceiptAmount: 3000, appliedToOrderAmount: 2000, imageUrl: '/original.png' });
    expect(result.pagination.totalItems).toBe(1);
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
            orderNo: 'QZ-01',
            amount: 100,
            receipts: [{ usd: 30, status: 'Waiting_SWIFT' }, { usd: 20, status: 'RECEIVED' }],
          },
          {
            id: 'order-2',
            orderNo: 'QZ-02',
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
          expect.objectContaining({ orderNo: 'QZ-01', orderBalance: 50, isSystemOrder: false }),
          expect.objectContaining({ orderNo: 'QZ-02', orderBalance: 50, isSystemOrder: false }),
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

  it.each([true, false])('exposes only one pool for a retained credit (persisted pool: %s)', async (hasPool) => {
    const pool = { rows: [{ id: 'retained-credit' }], availableTotal: '5.00', reservedTotal: '0.00', heldTotal: '0.00' };
    (loadDepositPool as jest.Mock).mockResolvedValueOnce(pool);
    const invoice = { id: 'inv-1', invNo: 'INV-1', createdAt: new Date(0), orders: [] };
    mockDb.invoice.findMany.mockResolvedValueOnce(hasPool
      ? [invoice, { ...invoice, id: 'existing-pool', invNo: 'DEPOSIT_POOL' }]
      : [invoice]);

    const { data } = await listInvoiceRecords(makeUser() as never, '');

    expect(data.map(row => row.invNo)).toEqual(['DEPOSIT_POOL', 'INV-1']);
    expect(data[0]).toMatchObject({ id: hasPool ? 'existing-pool' : 'deposit-pool-view', depositPool: pool });
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
        invNo: 'INV-QZ-001',
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

    const result = await listInvoiceRecords(makeUser() as never, 'QZ-001');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].invNo).toBe('INV-QZ-001');
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ count: 1, search: 'QZ-001' }),
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
