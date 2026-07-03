import {
  CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS,
  normalizeCustomerHistoryPagination,
  paginateCustomerHistoryRows,
  sortCustomerHistoryOrders,
} from './customer-order-history-pagination';

describe('customer order history sorting and pagination', () => {
  it('keeps page size options independent from global list pagination options', () => {
    expect(CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS).toEqual([5, 10, 15, 20]);
  });

  it('sorts active balances first, then low balances, with confirmed date subgroups', () => {
    const rows = [
      { id: 'low-release', outstanding: 5, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-30'), createdAt: new Date('2026-06-01') },
      { id: 'active-ship', outstanding: 50, amount: 100, shipDate: new Date('2026-06-20'), releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-empty-small', outstanding: 20, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-release-old', outstanding: 30, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-10'), createdAt: new Date('2026-06-01') },
      { id: 'low-empty', outstanding: 8, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-release-new', outstanding: 40, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-25'), createdAt: new Date('2026-06-01') },
      { id: 'active-empty-large', outstanding: 90, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'low-ship', outstanding: 2, amount: 100, shipDate: new Date('2026-07-01'), releaseDate: null, createdAt: new Date('2026-06-01') },
    ];

    expect(sortCustomerHistoryOrders(rows).map((row) => row.id)).toEqual([
      'active-empty-large',
      'active-empty-small',
      'active-release-new',
      'active-release-old',
      'active-ship',
      'low-empty',
      'low-release',
      'low-ship',
    ]);
  });

  it('normalizes invalid page input and clamps pages after slicing', () => {
    expect(normalizeCustomerHistoryPagination(
      { page: '0', pageSize: '999' },
      { defaultPageSize: 15 },
    )).toEqual({ page: 1, pageSize: 15 });

    expect(paginateCustomerHistoryRows(['a', 'b', 'c', 'd', 'e', 'f'], 9, 5)).toEqual({
      items: ['f'],
      pagination: { page: 2, pageSize: 5, totalItems: 6, totalPages: 2 },
    });
  });
});
