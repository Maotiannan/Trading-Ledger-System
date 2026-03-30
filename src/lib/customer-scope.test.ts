import { db } from '@/lib/db';
import {
  findDuplicateCustomersInScope,
  resolveCustomerUpsertTargetId,
} from '@/lib/customer-scope';

jest.mock('@/lib/db', () => ({
  db: {
    customer: {
      findMany: jest.fn(),
    },
  },
}));

const mockDb = db as unknown as {
  customer: { findMany: jest.Mock };
};

describe('customer-scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not treat phone-only matches as duplicate customers', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        ownerId: 'sales-1',
        owner: { email: 'sales@example.com' },
      },
    ]);

    const result = await findDuplicateCustomersInScope('sales-1', {
      mark: 'SARA',
      name: 'Sara Diallo',
      phone: '+224 622 44 31 03',
    });

    expect(result).toEqual([]);
  });

  it('still treats MARK+NAME matches as duplicate customers even when phones differ', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([
      {
        id: 'customer-1',
        mark: 'IB',
        orderName: 'IB',
        name: 'Ibrahima',
        phone: '622443103',
        ownerId: 'sales-1',
        owner: { email: 'sales@example.com' },
      },
    ]);

    const result = await findDuplicateCustomersInScope('sales-1', {
      mark: 'IB',
      name: 'Ibrahima',
      phone: '620000000',
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'customer-1',
        mark: 'IB',
        name: 'Ibrahima',
      }),
    ]);
  });

  it('does not auto-resolve customer fix target from phone-only matches', async () => {
    mockDb.customer.findMany.mockResolvedValueOnce([]);

    const result = await resolveCustomerUpsertTargetId('sales-1', {
      orderName: 'TARGET',
      phone: '+224 622 44 31 03',
      companyName: null,
    });

    expect(result).toBeNull();
    expect(mockDb.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ownerId: 'sales-1',
        OR: [{ orderName: { equals: 'TARGET' } }],
      },
    }));
  });
});
