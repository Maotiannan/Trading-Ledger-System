export const LIST_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
export const DEFAULT_LIST_PAGE_SIZE = 10;

export type ListPageSizeOption = typeof LIST_PAGE_SIZE_OPTIONS[number];

export type UserListPageSizePreference = {
  detail: ListPageSizeOption;
  swift: ListPageSizeOption;
};

export const DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE: UserListPageSizePreference = Object.freeze({
  detail: DEFAULT_LIST_PAGE_SIZE,
  swift: DEFAULT_LIST_PAGE_SIZE,
});

function isListPageSizeOption(value: unknown): value is ListPageSizeOption {
  return LIST_PAGE_SIZE_OPTIONS.includes(Number(value) as ListPageSizeOption);
}

export function normalizeListPageSizePreference(value: unknown): UserListPageSizePreference {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<keyof UserListPageSizePreference, unknown>>
    : {};

  return {
    detail: isListPageSizeOption(source.detail)
      ? Number(source.detail) as ListPageSizeOption
      : DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE.detail,
    swift: isListPageSizeOption(source.swift)
      ? Number(source.swift) as ListPageSizeOption
      : DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE.swift,
  };
}

export function validateListPageSizePreference(value: unknown): UserListPageSizePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE;
  }

  const source = value as Partial<Record<keyof UserListPageSizePreference, unknown>>;
  const next = { ...DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE };

  for (const key of Object.keys(source) as Array<keyof UserListPageSizePreference>) {
    if (!(key in DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE)) continue;
    if (!isListPageSizeOption(source[key])) {
      throw new Error(`Invalid list page size for ${key}`);
    }
    next[key] = Number(source[key]) as ListPageSizeOption;
  }

  return next;
}
