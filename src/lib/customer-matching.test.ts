import { db } from '@/lib/db';
import { resolveCustomer } from '@/lib/customer-matching';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: jest.fn(),
    },
    customerOrderName: {
      findMany: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  customer: { findMany: jest.Mock };
  customerOrderName: { findMany: jest.Mock };
};

describe('customer-matching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches a customer mark while ignoring spaces and keeps the canonical mark', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'SDT 2',
        orderName: 'SUPER DT 2',
        phone: '620000001',
        city: 'Conakry',
        orderNames: [{ orderName: 'SUPER DT 2', normalizedOrderName: 'superdt2' }],
      },
    ]);

    const result = await resolveCustomer({
      customerMark: 'SDT2',
      customerOrderNo: 'SUPERDT2-09',
      ownerIds: ['sales-1'],
    });

    expect(result).toEqual(expect.objectContaining({
      customerId: 'customer-1',
      customerMark: 'SDT 2',
      customerName: 'SUPER DT 2',
      matchedBy: 'mark',
      needsCustomerFix: false,
    }));
  });

  it('falls back to matched ORDER_NAME alias when mark does not match', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([]);
    mockDb.customerOrderName.findMany.mockResolvedValueOnce([
      {
        orderName: 'MARY',
        normalizedOrderName: 'mary',
        customer: {
          id: 'customer-2',
          mark: 'MAB 1',
          orderName: 'MAB-1',
          phone: '620000002',
          city: 'Conakry',
        },
      },
    ]);

    const result = await resolveCustomer({
      customerMark: 'unmatched',
      customerOrderNo: 'M A R Y -01',
      ownerIds: ['sales-1'],
    });

    expect(result).toEqual(expect.objectContaining({
      customerId: 'customer-2',
      customerMark: 'MAB 1',
      customerName: 'MARY',
      matchedBy: 'name',
      needsCustomerFix: false,
    }));
  });
});
