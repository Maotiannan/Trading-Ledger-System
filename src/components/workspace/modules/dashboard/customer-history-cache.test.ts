import {
  clearCustomerHistoryCache,
  makeCustomerHistoryCacheKey,
  readCustomerHistoryCache,
  rememberCustomerHistory,
} from './customer-history-cache';

describe('customer history cache', () => {
  beforeEach(() => {
    clearCustomerHistoryCache();
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('isolates users and pagination variants, then expires after 30 seconds', () => {
    const key = makeCustomerHistoryCacheKey({
      userId: 'user-a',
      customerId: 'customer-1',
      orderPage: 1,
      orderPageSize: 10,
      receiptPage: 1,
      receiptPageSize: 10,
    });
    const value = {
      customer: { id: 'customer-1', mark: 'MAB', name: 'Mamadou' },
      orders: [],
      receipts: [],
      orderPagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
      receiptPagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    };

    rememberCustomerHistory(key, value);
    expect(readCustomerHistoryCache(key)).toEqual({ value, fresh: true });
    expect(readCustomerHistoryCache(`${key}:other-user`)).toBeNull();

    jest.spyOn(Date, 'now').mockReturnValue(31_001);
    expect(readCustomerHistoryCache(key)).toEqual({ value, fresh: false });
  });
});
