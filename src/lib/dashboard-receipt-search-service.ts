import { db } from '@/lib/db';
import { findMatchingOrder } from '@/lib/matching';
import { buildReceiptVisibilityWhere, getOwnerVisibleIds } from '@/lib/resource-visibility';
import type { CurrentUser } from '@/lib/request-auth';

export const DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE = 10 as const;

export type DashboardReceiptSearchItem = {
  id: string;
  orderNo: string;
  date: string | null;
  amount: number;
  status: string;
};

export type DashboardReceiptSearchResult = {
  matched: boolean;
  inputOrderNo: string;
  matchedOrderNo: string | null;
  items: DashboardReceiptSearchItem[];
  pagination: {
    page: number;
    pageSize: typeof DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE;
    totalItems: number;
    totalPages: number;
  };
};

function normalizePage(page: unknown): number {
  const numeric = Number(page);
  if (!Number.isFinite(numeric) || numeric < 1) return 1;
  return Math.floor(numeric);
}

function effectiveReceiptDate(row: { date: Date | null; createdAt: Date }): Date {
  return row.date || row.createdAt;
}

function emptySearchResult(inputOrderNo: string, page: number): DashboardReceiptSearchResult {
  return {
    matched: false,
    inputOrderNo,
    matchedOrderNo: null,
    items: [],
    pagination: {
      page,
      pageSize: DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE,
      totalItems: 0,
      totalPages: 1,
    },
  };
}

export async function searchDashboardReceiptsByOrderNo(
  currentUser: CurrentUser,
  params: { orderNo: string; page?: number },
): Promise<DashboardReceiptSearchResult> {
  const inputOrderNo = (params.orderNo || '').trim();
  const requestedPage = normalizePage(params.page);

  if (!inputOrderNo) {
    return emptySearchResult(inputOrderNo, requestedPage);
  }

  const matchedOrder = await findMatchingOrder(inputOrderNo);
  if (!matchedOrder) {
    return emptySearchResult(inputOrderNo, requestedPage);
  }

  const ownerIds = await getOwnerVisibleIds(currentUser);
  const where = {
    AND: [
      buildReceiptVisibilityWhere(ownerIds),
      { orderId: matchedOrder.orderId },
    ],
  };

  const [totalItems, rows] = await Promise.all([
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      select: { id: true, orderNo: true, date: true, createdAt: true, usd: true, status: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE;
  const sortedRows = rows.slice().sort((left, right) => {
    const byEffectiveDate = effectiveReceiptDate(right).getTime() - effectiveReceiptDate(left).getTime();
    if (byEffectiveDate !== 0) return byEffectiveDate;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });

  return {
    matched: true,
    inputOrderNo,
    matchedOrderNo: matchedOrder.orderNo,
    items: sortedRows.slice(start, start + DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE).map((row) => ({
      id: row.id,
      orderNo: row.orderNo || matchedOrder.orderNo,
      date: effectiveReceiptDate(row).toISOString(),
      amount: Number(row.usd),
      status: row.status,
    })),
    pagination: {
      page,
      pageSize: DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE,
      totalItems,
      totalPages,
    },
  };
}
