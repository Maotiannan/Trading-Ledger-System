import { resolveMuContractOrderCustomer } from '@/lib/integrations/mu-contract-customer-resolver';

function makeCustomer() {
  return {
    id: 'customer-1',
    mark: 'AB',
    normalizedMark: 'ab',
    orderName: 'AB',
    orderNames: [{ orderName: 'AB', normalizedOrderName: 'ab', isPrimary: true }],
    name: 'Alpha Buyer',
    phone: '+224 600 00 00 00',
    city: 'Conakry',
    consignee: null,
    companyName: 'Alpha Buyer Ltd',
    companyAddress: 'Kaloum',
    credit: null,
  };
}

function createExecutor() {
  return {
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }, { id: 'sales-1' }]) },
    order: { findMany: jest.fn() },
    orderAlias: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    customerOrderName: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('MU Contract global customer resolver', () => {
  it('uses the shared composite-order alias path across all owners', async () => {
    const executor = createExecutor();
    executor.order.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'order-1',
        orderNo: 'AB-13B/AB-12B',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        customer: makeCustomer(),
        invoice: { id: 'invoice-1', invNo: 'L26MH001', createdAt: new Date('2026-07-01T00:00:00.000Z') },
      }]);
    executor.orderAlias.findFirst.mockResolvedValue({ orderId: 'order-1' });

    const result = await resolveMuContractOrderCustomer(executor, 'AB-13B');

    expect(result).toEqual(expect.objectContaining({
      status: 'MATCHED',
      customerId: 'customer-1',
      orderId: 'order-1',
      matchedOrderNo: 'AB-13B/AB-12B',
    }));
    expect(executor.user.findMany).toHaveBeenCalledWith({ select: { id: true } });
  });

  it('returns UNMATCHED without replacing the shared lookup error', async () => {
    const executor = createExecutor();
    executor.order.findMany.mockResolvedValue([]);
    executor.orderAlias.findFirst.mockResolvedValue(null);

    const result = await resolveMuContractOrderCustomer(executor, 'UNKNOWN-01');

    expect(result).toEqual(expect.objectContaining({
      status: 'UNMATCHED',
      code: 'EXCEL_ORDER_NOT_FOUND',
    }));
  });

  it('returns CONFLICT when the shared matcher finds multiple customers', async () => {
    const executor = createExecutor();
    executor.order.findMany.mockResolvedValue([]);
    executor.orderAlias.findFirst.mockResolvedValue(null);
    executor.customerOrderName.findMany.mockResolvedValue([
      { orderName: 'AB', customer: makeCustomer() },
      { orderName: 'AB', customer: { ...makeCustomer(), id: 'customer-2' } },
    ]);

    const result = await resolveMuContractOrderCustomer(executor, 'AB-13B');

    expect(result).toEqual(expect.objectContaining({
      status: 'CONFLICT',
      code: 'EXCEL_ORDER_CONFLICT',
    }));
  });
});
