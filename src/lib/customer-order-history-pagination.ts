export const CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS = [5, 10, 15, 20] as const;
export const DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE = 10;

export type CustomerHistoryPageSizeOption = typeof CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS[number];

export type CustomerHistoryPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type SortableHistoryOrder = {
  id: string;
  outstanding: number;
  shipDate?: Date | string | null;
  releaseDate?: Date | string | null;
  createdAt?: Date | string | null;
};

function isAllowedPageSize(value: number): value is CustomerHistoryPageSizeOption {
  return CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS.includes(value as CustomerHistoryPageSizeOption);
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  return integer > 0 ? integer : fallback;
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function dateGroup(row: SortableHistoryOrder): 0 | 1 | 2 {
  if (timestamp(row.releaseDate) !== null) return 1;
  if (timestamp(row.shipDate) !== null) return 2;
  return 0;
}

export function normalizeCustomerHistoryPageSize(value: unknown, fallback = DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE): CustomerHistoryPageSizeOption {
  const fallbackSize = isAllowedPageSize(Number(fallback)) ? Number(fallback) as CustomerHistoryPageSizeOption : DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE;
  const parsed = Number(value);
  return isAllowedPageSize(parsed) ? parsed : fallbackSize;
}

export function normalizeCustomerHistoryPagination(
  input: { page?: unknown; pageSize?: unknown },
  options: { defaultPageSize?: number } = {},
): { page: number; pageSize: CustomerHistoryPageSizeOption } {
  return {
    page: toPositiveInt(input.page, 1),
    pageSize: normalizeCustomerHistoryPageSize(input.pageSize, options.defaultPageSize),
  };
}

export function sortCustomerHistoryOrders<T extends SortableHistoryOrder>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const balanceGroupDiff = Number(left.outstanding <= 10) - Number(right.outstanding <= 10);
    if (balanceGroupDiff !== 0) return balanceGroupDiff;

    const leftGroup = dateGroup(left);
    const rightGroup = dateGroup(right);
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;

    if (leftGroup === 0 && left.outstanding !== right.outstanding) {
      return right.outstanding - left.outstanding;
    }

    if (leftGroup === 1) {
      const diff = (timestamp(right.releaseDate) || 0) - (timestamp(left.releaseDate) || 0);
      if (diff !== 0) return diff;
    }

    if (leftGroup === 2) {
      const diff = (timestamp(right.shipDate) || 0) - (timestamp(left.shipDate) || 0);
      if (diff !== 0) return diff;
    }

    const createdDiff = (timestamp(right.createdAt) || 0) - (timestamp(left.createdAt) || 0);
    if (createdDiff !== 0) return createdDiff;
    return left.id.localeCompare(right.id);
  });
}

export function paginateCustomerHistoryRows<T>(rows: T[], page: number, pageSize: number): { items: T[]; pagination: CustomerHistoryPagination } {
  const normalizedPageSize = normalizeCustomerHistoryPageSize(pageSize);
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const normalizedPage = Math.min(toPositiveInt(page, 1), totalPages);
  const start = (normalizedPage - 1) * normalizedPageSize;

  return {
    items: rows.slice(start, start + normalizedPageSize),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalItems,
      totalPages,
    },
  };
}
