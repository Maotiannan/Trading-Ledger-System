import { CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS, DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE, type CustomerHistoryPageSizeOption } from '@/lib/customer-order-history-pagination';

export const LIST_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
export const DEFAULT_LIST_PAGE_SIZE = 10;

export type ListPageSizeOption = typeof LIST_PAGE_SIZE_OPTIONS[number];

export type UserListPageSizePreference = {
  detail: ListPageSizeOption;
  swift: ListPageSizeOption;
  receipt: ListPageSizeOption;
  customerHistoryOrders: CustomerHistoryPageSizeOption;
  customerHistoryReceipts: CustomerHistoryPageSizeOption;
};

export const DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE: UserListPageSizePreference = Object.freeze({
  detail: DEFAULT_LIST_PAGE_SIZE,
  swift: DEFAULT_LIST_PAGE_SIZE,
  receipt: 20,
  customerHistoryOrders: DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE,
  customerHistoryReceipts: DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE,
});

function isListPageSizeOption(value: unknown): value is ListPageSizeOption {
  return LIST_PAGE_SIZE_OPTIONS.includes(Number(value) as ListPageSizeOption);
}

function isCustomerHistoryPageSizeOption(value: unknown): value is CustomerHistoryPageSizeOption {
  return CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS.includes(Number(value) as CustomerHistoryPageSizeOption);
}

export function getListPageSizeOptions(key: keyof UserListPageSizePreference): readonly number[] {
  return key === 'customerHistoryOrders' || key === 'customerHistoryReceipts'
    ? CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS
    : LIST_PAGE_SIZE_OPTIONS;
}

function isValidPageSizeForKey(key: keyof UserListPageSizePreference, value: unknown): boolean {
  return key === 'customerHistoryOrders' || key === 'customerHistoryReceipts'
    ? isCustomerHistoryPageSizeOption(value)
    : isListPageSizeOption(value);
}

export function normalizeListPageSizePreference(value: unknown): UserListPageSizePreference {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof UserListPageSizePreference, unknown>>
    : {};

  const next = { ...DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE };
  for (const key of Object.keys(next) as Array<keyof UserListPageSizePreference>) {
    if (isValidPageSizeForKey(key, source[key])) {
      next[key] = Number(source[key]) as never;
    }
  }
  return next;
}

export function validateListPageSizePreference(value: unknown): UserListPageSizePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE;
  }

  const source = value as Partial<Record<keyof UserListPageSizePreference, unknown>>;
  const next = { ...DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE };

  for (const key of Object.keys(source) as Array<keyof UserListPageSizePreference>) {
    if (!(key in DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE)) continue;
    if (!isValidPageSizeForKey(key, source[key])) {
      throw new Error(`Invalid list page size for ${key}`);
    }
    next[key] = Number(source[key]) as never;
  }

  return next;
}
