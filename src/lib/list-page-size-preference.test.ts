import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  getListPageSizeOptions,
  normalizeListPageSizePreference,
  validateListPageSizePreference,
} from './list-page-size-preference';

describe('list page size preference', () => {
  it('defaults receipt pagination to 20 rows and customer history pagination to 10 rows', () => {
    expect(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE).toEqual({
      detail: 10,
      swift: 10,
      receipt: 20,
      customerHistoryOrders: 10,
      customerHistoryReceipts: 10,
    });

    expect(normalizeListPageSizePreference({ detail: 50, swift: 20 })).toEqual({
      detail: 50,
      swift: 20,
      receipt: 20,
      customerHistoryOrders: 10,
      customerHistoryReceipts: 10,
    });
  });

  it('preserves a valid account-level receipt page size', () => {
    expect(validateListPageSizePreference({ receipt: 50 })).toEqual({
      detail: 10,
      swift: 10,
      receipt: 50,
      customerHistoryOrders: 10,
      customerHistoryReceipts: 10,
    });
  });

  it('allows 15 only for customer history page sizes', () => {
    expect(getListPageSizeOptions('customerHistoryOrders')).toEqual([5, 10, 15, 20]);
    expect(getListPageSizeOptions('receipt')).toEqual([5, 10, 20, 50]);
    expect(validateListPageSizePreference({ customerHistoryOrders: 15, customerHistoryReceipts: 20 })).toEqual({
      detail: 10,
      swift: 10,
      receipt: 20,
      customerHistoryOrders: 15,
      customerHistoryReceipts: 20,
    });
    expect(() => validateListPageSizePreference({ receipt: 15 })).toThrow('Invalid list page size for receipt');
  });
});
