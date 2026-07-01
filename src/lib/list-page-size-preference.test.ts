import {
  DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE,
  normalizeListPageSizePreference,
  validateListPageSizePreference,
} from './list-page-size-preference';

describe('list page size preference', () => {
  it('defaults receipt pagination to 20 rows for new and existing accounts', () => {
    expect(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE).toEqual({
      detail: 10,
      swift: 10,
      receipt: 20,
    });

    expect(normalizeListPageSizePreference({ detail: 50, swift: 20 })).toEqual({
      detail: 50,
      swift: 20,
      receipt: 20,
    });
  });

  it('preserves a valid account-level receipt page size', () => {
    expect(validateListPageSizePreference({ receipt: 50 })).toEqual({
      detail: 10,
      swift: 10,
      receipt: 50,
    });
  });
});
