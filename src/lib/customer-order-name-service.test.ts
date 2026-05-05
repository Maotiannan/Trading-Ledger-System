import { db } from '@/lib/db';
import { buildCustomerOrderNameWrites, findCustomerOrderNameMatches } from '@/lib/customer-order-name-service';

jest.mock('@/lib/db', () => ({
  db: {
    customerOrderName: {
      findMany: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  customerOrderName: { findMany: jest.Mock };
};

describe('customer-order-name-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds a deduplicated set of aliases and marks the primary row', () => {
    expect(
      buildCustomerOrderNameWrites('customer-1', 'MAB-1', ['MARY', ' M A B - 1 ', 'MARY ']),
    ).toEqual([
      {
        customerId: 'customer-1',
        orderName: 'MAB-1',
        normalizedOrderName: 'mab-1',
        isPrimary: true,
      },
      {
        customerId: 'customer-1',
        orderName: 'MARY',
        normalizedOrderName: 'mary',
        isPrimary: false,
      },
    ]);
  });

  it('preserves a dashed ORDER_NAME as a raw candidate while also checking the derived prefix', async () => {
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        id: 'alias-1',
        isPrimary: true,
        createdAt: new Date('2026-05-05T00:00:00.000Z'),
        orderName: 'GANDO-invoice-1777976411408-68423',
        normalizedOrderName: 'gando-invoice-1777976411408-68423',
        customer: {
          id: 'customer-1',
          mark: 'KIGNA TEXTILE',
          orderName: 'GANDO-invoice-1777976411408-68423',
          name: 'Fallback Customer',
          phone: '620000001',
          city: 'Conakry',
          consignee: null,
          companyName: null,
          companyAddress: null,
          credit: null,
        },
      },
    ]);

    const rows = await findCustomerOrderNameMatches(['sales-1'], 'GANDO-invoice-1777976411408-68423');

    expect(mockDb.customerOrderName.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        normalizedOrderName: {
          in: ['gando-invoice-1777976411408-68423', 'gando-invoice-1777976411408'],
        },
      }),
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customer.id).toBe('customer-1');
  });

  it('matches a full ORDER NO by checking the derived prefix candidate', async () => {
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        id: 'alias-2',
        isPrimary: true,
        createdAt: new Date('2026-05-05T00:00:00.000Z'),
        orderName: 'SUPER DT 2',
        normalizedOrderName: 'superdt2',
        customer: {
          id: 'customer-2',
          mark: 'SDT 2',
          orderName: 'SUPER DT 2',
          name: 'Customer Two',
          phone: '620000002',
          city: 'Conakry',
          consignee: null,
          companyName: null,
          companyAddress: null,
          credit: null,
        },
      },
    ]);

    const rows = await findCustomerOrderNameMatches(['sales-1'], 'S U P E R D T 2 -01');

    expect(mockDb.customerOrderName.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        normalizedOrderName: {
          in: ['superdt2-01', 'superdt2'],
        },
      }),
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customer.mark).toBe('SDT 2');
  });
});
