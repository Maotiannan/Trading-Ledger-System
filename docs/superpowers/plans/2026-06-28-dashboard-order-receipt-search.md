# Dashboard Order Receipt Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dashboard card that searches receipts by ORDER NO using the shared ORDER NO matching rules, with fixed-bottom pagination across Dashboard list cards.

**Architecture:** Add a small dedicated server-side receipt search service and API route so Dashboard summary remains fast. Register a new Dashboard card in the per-account layout registry, then render an independent client card that calls the API only when the user searches. Extract/standardize Dashboard card pagination layout so list card footers stay at the card bottom even when a page has few rows.

**Tech Stack:** Next.js App Router API routes, Prisma/MySQL, Jest, React Testing Library, existing `apiCall`, existing dashboard preference registry, existing `findMatchingOrder` and receipt visibility helpers.

## Global Constraints

- Input ORDER NO must first use the existing project ORDER NO matching logic; do not raw-search receipts when matching fails.
- `/` composite order rows must resolve by any segment and return the full matched ORDER NO record.
- Receipt rows must obey the current account visibility scope.
- Page size is fixed at 10 rows and is not controlled by the browser request.
- Table columns are ORDER NO / Date / Amount / Status.
- Date means `Receipt.date`; if empty, fall back to `Receipt.createdAt`.
- Sort by effective date newest first; same date sorts by `createdAt` newest first.
- Dashboard card is visible by default, belongs to the analysis section, and participates in Dashboard Settings ordering/visibility.
- Pagination controls for Released Unpaid Invoices, Customer Outstanding Ranking, and the new search card must stay at the card bottom.
- No database schema or media path changes; backup scope is unchanged.
- Do not rebuild Docker unless explicitly requested after implementation.

---

## File Structure

- Modify: `src/lib/dashboard-layout-preference.ts`
  - Add `order-receipt-search` to `DASHBOARD_CARD_REGISTRY` in the `analysis` section after `customer-outstanding-ranking`.
- Modify: `src/lib/dashboard-layout-preference.test.ts`
  - Update default card order and future-card normalization expectations.
- Create: `src/lib/dashboard-receipt-search-service.ts`
  - Server-only service for ORDER NO resolution, visibility, paginated receipt query, and response shape.
- Create: `src/lib/dashboard-receipt-search-service.test.ts`
  - Unit tests for exact/composite matching, no-match behavior, visibility where clause, sorting, date fallback, and fixed page size.
- Create: `src/app/api/dashboard/receipt-search/route.ts`
  - Authenticated API endpoint for `GET /api/dashboard/receipt-search?orderNo=<value>&page=<number>`.
- Create: `src/app/api/dashboard/receipt-search/route.test.ts`
  - Route tests for valid search, missing ORDER NO, invalid page, and service error mapping.
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
  - Add new card state, search handler, table rendering, Enter-to-search, and reusable bottom pagination layout.
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`
  - Add frontend tests for search, matched display, no-match message, page reuse, Enter behavior, and no floating pagination.
- Modify: `package.json`
  - Bump version from `1.0.183` to `1.0.184`.
- Modify: `README.md`
  - Keep user-facing README concise; add one line for Dashboard ORDER receipt search if the feature list exists.
- Optional Modify: `docs/ENGINEERING_LOG.md` or existing project changelog if present.
  - Add a concise engineering note with tests run. If no established changelog exists, do not create a new scattered file.

## Interfaces

### Service Types

```ts
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
    pageSize: 10;
    totalItems: number;
    totalPages: number;
  };
};

export async function searchDashboardReceiptsByOrderNo(
  currentUser: CurrentUser,
  params: { orderNo: string; page?: number },
): Promise<DashboardReceiptSearchResult>;
```

### API Contract

```http
GET /api/dashboard/receipt-search?orderNo=PIKIN-20&page=1
```

Success with rows:

```json
{
  "success": true,
  "data": {
    "matched": true,
    "inputOrderNo": "PIKIN-20",
    "matchedOrderNo": "PIKIN-20",
    "items": [
      { "id": "receipt-1", "orderNo": "PIKIN-20", "date": "2026-06-20T00:00:00.000Z", "amount": 2500, "status": "SR_Received" }
    ],
    "pagination": { "page": 1, "pageSize": 10, "totalItems": 1, "totalPages": 1 }
  }
}
```

Success with no matched ORDER:

```json
{
  "success": true,
  "data": {
    "matched": false,
    "inputOrderNo": "UNKNOWN-01",
    "matchedOrderNo": null,
    "items": [],
    "pagination": { "page": 1, "pageSize": 10, "totalItems": 0, "totalPages": 1 }
  }
}
```

---

### Task 1: Register Dashboard Card

**Files:**
- Modify: `src/lib/dashboard-layout-preference.ts`
- Modify: `src/lib/dashboard-layout-preference.test.ts`

**Interfaces:**
- Produces card id: `order-receipt-search` as `DashboardCardId`.
- Later UI uses this exact id in `renderDashboardCard`.

- [ ] **Step 1: Write failing registry test**

Update the first test in `src/lib/dashboard-layout-preference.test.ts` to expect nine cards and include the new card after `customer-outstanding-ranking`:

```ts
expect(layout.sections.flatMap((section) => section.cards.map((card) => card.id))).toEqual([
  'invoice-balance',
  'pending-receipts',
  'waiting-swift',
  'pending-approvals',
  'released-unpaid-invoices',
  'customer-outstanding-ranking',
  'order-receipt-search',
  'recent-receipts',
  'recent-payment-details',
]);
```

Add this assertion to `appends future missing cards from the registry into their default section`:

```ts
expect(layout.sections.find((section) => section.id === 'analysis')?.cards.map((card) => card.id)).toEqual([
  'released-unpaid-invoices',
  'customer-outstanding-ranking',
  'order-receipt-search',
]);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- src/lib/dashboard-layout-preference.test.ts --runInBand
```

Expected: FAIL because `order-receipt-search` is not registered.

- [ ] **Step 3: Add registry entry**

In `src/lib/dashboard-layout-preference.ts`, add this row after `customer-outstanding-ranking`:

```ts
{ id: 'order-receipt-search', sectionId: 'analysis', defaultOrder: 30, zh: '订单收据查询', en: 'Order Receipt Search' },
```

- [ ] **Step 4: Run passing test**

Run:

```bash
npm test -- src/lib/dashboard-layout-preference.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-layout-preference.ts src/lib/dashboard-layout-preference.test.ts
git commit -m "feat: register dashboard order receipt search card"
```

---

### Task 2: Add Receipt Search Service

**Files:**
- Create: `src/lib/dashboard-receipt-search-service.ts`
- Create: `src/lib/dashboard-receipt-search-service.test.ts`

**Interfaces:**
- Consumes: `findMatchingOrder(orderNo)` from `src/lib/matching.ts`.
- Consumes: `getOwnerVisibleIds(currentUser)` and `buildReceiptVisibilityWhere(ownerIds)` from `src/lib/resource-visibility.ts`.
- Produces: `searchDashboardReceiptsByOrderNo(currentUser, { orderNo, page })`.

- [ ] **Step 1: Write failing service tests**

Create `src/lib/dashboard-receipt-search-service.test.ts`:

```ts
import { db } from '@/lib/db';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';
import { findMatchingOrder } from '@/lib/matching';
import { buildReceiptVisibilityWhere, getOwnerVisibleIds } from '@/lib/resource-visibility';

jest.mock('@/lib/db', () => ({
  db: {
    receipt: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/matching', () => ({
  findMatchingOrder: jest.fn(),
}));

jest.mock('@/lib/resource-visibility', () => ({
  getOwnerVisibleIds: jest.fn(),
  buildReceiptVisibilityWhere: jest.fn(),
}));

const mockFindMatchingOrder = findMatchingOrder as jest.Mock;
const mockGetOwnerVisibleIds = getOwnerVisibleIds as jest.Mock;
const mockBuildReceiptVisibilityWhere = buildReceiptVisibilityWhere as jest.Mock;
const mockReceiptCount = db.receipt.count as jest.Mock;
const mockReceiptFindMany = db.receipt.findMany as jest.Mock;

const currentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

describe('searchDashboardReceiptsByOrderNo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOwnerVisibleIds.mockResolvedValue(['admin-1', 'sales-1']);
    mockBuildReceiptVisibilityWhere.mockReturnValue({ createdBy: { in: ['admin-1', 'sales-1'] } });
  });

  it('returns matched receipts by matched order id using fixed page size', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce({
      orderId: 'order-pikin-group',
      orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
      amount: 30000,
      orderBalance: 17869,
    });
    mockReceiptCount.mockResolvedValueOnce(11);
    mockReceiptFindMany.mockResolvedValueOnce([
      {
        id: 'receipt-new',
        orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
        date: null,
        createdAt: new Date('2026-06-21T08:00:00.000Z'),
        usd: 2500,
        status: 'SR_Received',
      },
    ]);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'PIKIN-19B', page: 2 });

    expect(mockFindMatchingOrder).toHaveBeenCalledWith('PIKIN-19B');
    expect(mockReceiptCount).toHaveBeenCalledWith({
      where: {
        AND: [
          { createdBy: { in: ['admin-1', 'sales-1'] } },
          { orderId: 'order-pikin-group' },
        ],
      },
    });
    expect(mockReceiptFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, orderNo: true, date: true, createdAt: true, usd: true, status: true },
    }));
    expect(result).toEqual({
      matched: true,
      inputOrderNo: 'PIKIN-19B',
      matchedOrderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
      items: [
        {
          id: 'receipt-new',
          orderNo: 'PIKIN-19_B/PIKIN-19B/PIKIN-21',
          date: '2026-06-21T08:00:00.000Z',
          amount: 2500,
          status: 'SR_Received',
        },
      ],
      pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 },
    });
  });

  it('does not search raw receipts when order matching fails', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce(null);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'UNKNOWN-01', page: 1 });

    expect(mockReceiptCount).not.toHaveBeenCalled();
    expect(mockReceiptFindMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      matched: false,
      inputOrderNo: 'UNKNOWN-01',
      matchedOrderNo: null,
      items: [],
      pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    });
  });

  it('normalizes invalid pages back to page 1', async () => {
    mockFindMatchingOrder.mockResolvedValueOnce({ orderId: 'order-1', orderNo: 'AB-01', amount: 100, orderBalance: 0 });
    mockReceiptCount.mockResolvedValueOnce(0);
    mockReceiptFindMany.mockResolvedValueOnce([]);

    const result = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo: 'AB-01', page: -20 });

    expect(mockReceiptFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
    expect(result.pagination.page).toBe(1);
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- src/lib/dashboard-receipt-search-service.test.ts --runInBand
```

Expected: FAIL because `src/lib/dashboard-receipt-search-service.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `src/lib/dashboard-receipt-search-service.ts`:

```ts
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
  const page = normalizePage(params.page);

  if (!inputOrderNo) {
    return emptySearchResult(inputOrderNo, page);
  }

  const matchedOrder = await findMatchingOrder(inputOrderNo);
  if (!matchedOrder) {
    return emptySearchResult(inputOrderNo, page);
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
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE,
      take: DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE,
      select: { id: true, orderNo: true, date: true, createdAt: true, usd: true, status: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalItems / DASHBOARD_RECEIPT_SEARCH_PAGE_SIZE));

  return {
    matched: true,
    inputOrderNo,
    matchedOrderNo: matchedOrder.orderNo,
    items: rows.map((row) => ({
      id: row.id,
      orderNo: row.orderNo || matchedOrder.orderNo,
      date: (row.date || row.createdAt)?.toISOString() ?? null,
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
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test -- src/lib/dashboard-receipt-search-service.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-receipt-search-service.ts src/lib/dashboard-receipt-search-service.test.ts
git commit -m "feat: add dashboard receipt search service"
```

---

### Task 3: Add Receipt Search API Route

**Files:**
- Create: `src/app/api/dashboard/receipt-search/route.ts`
- Create: `src/app/api/dashboard/receipt-search/route.test.ts`

**Interfaces:**
- Consumes: `searchDashboardReceiptsByOrderNo(currentUser, { orderNo, page })`.
- Produces: `GET /api/dashboard/receipt-search?orderNo=<value>&page=<number>`.

- [ ] **Step 1: Write failing API route tests**

Create `src/app/api/dashboard/receipt-search/route.test.ts`:

```ts
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => ({
      status: init?.status ?? 200,
      async json() {
        return body;
      },
    }),
  },
}));

let mockCurrentUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  level: 1,
  parentId: null,
  createdById: null,
};

jest.mock('@/lib/route-auth', () => ({
  withAuth: (handler: (request: Request, currentUser: unknown) => Promise<unknown>) => {
    return (request: Request) => handler(request, mockCurrentUser);
  },
}));

jest.mock('@/lib/dashboard-receipt-search-service', () => ({
  searchDashboardReceiptsByOrderNo: jest.fn(),
}));

import { GET } from '@/app/api/dashboard/receipt-search/route';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';

const mockSearch = searchDashboardReceiptsByOrderNo as jest.Mock;

describe('dashboard receipt search route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes authenticated search to the service', async () => {
    mockSearch.mockResolvedValueOnce({
      matched: true,
      inputOrderNo: 'PIKIN-20',
      matchedOrderNo: 'PIKIN-20',
      items: [],
      pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
    });

    const response = await GET({ url: 'https://example.com/api/dashboard/receipt-search?orderNo=PIKIN-20&page=1' } as never);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin-1' }), { orderNo: 'PIKIN-20', page: 1 });
    expect(json.success).toBe(true);
    expect(json.data.matchedOrderNo).toBe('PIKIN-20');
  });

  it('rejects missing order number with a readable 400 error', async () => {
    const response = await GET({ url: 'https://example.com/api/dashboard/receipt-search?page=1' } as never);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe('请输入 ORDER NO');
  });
});
```

- [ ] **Step 2: Run failing route test**

Run:

```bash
npm test -- src/app/api/dashboard/receipt-search/route.test.ts --runInBand
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route**

Create `src/app/api/dashboard/receipt-search/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createApiError } from '@/lib/api-error';
import { toApiErrorResponse } from '@/lib/api-error-response';
import { searchDashboardReceiptsByOrderNo } from '@/lib/dashboard-receipt-search-service';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/route-auth';

export const GET = withAuth(async (request: NextRequest, currentUser) => {
  try {
    const { searchParams } = new URL(request.url);
    const orderNo = (searchParams.get('orderNo') || '').trim();
    const page = Number(searchParams.get('page') || '1');

    if (!orderNo) {
      throw createApiError({
        code: 'BAD_REQUEST',
        status: 400,
        message: '请输入 ORDER NO',
      });
    }

    const data = await searchDashboardReceiptsByOrderNo(currentUser, { orderNo, page });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.error('Dashboard receipt search API error', error);
    return toApiErrorResponse(error, {
      code: 'INTERNAL_ERROR',
      status: 500,
      message: '服务器错误',
    }, request);
  }
});
```

- [ ] **Step 4: Run route tests**

Run:

```bash
npm test -- src/app/api/dashboard/receipt-search/route.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dashboard/receipt-search/route.ts src/app/api/dashboard/receipt-search/route.test.ts
git commit -m "feat: expose dashboard receipt search api"
```

---

### Task 4: Add Dashboard UI Card and Fixed Pagination Layout

**Files:**
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.tsx`
- Modify: `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`

**Interfaces:**
- Consumes API endpoint string: `dashboard/receipt-search?orderNo=${encodeURIComponent(orderNo)}&page=${page}` through `apiCall`.
- Consumes card id: `order-receipt-search`.

- [ ] **Step 1: Write failing frontend tests**

Add these helper expectations to `src/components/workspace/modules/dashboard/dashboard-view.test.tsx`:

```ts
it('searches receipts by ORDER NO from the dashboard card and reuses the matched order on pagination', async () => {
  mockApiCall.mockImplementation(async (endpoint: string) => {
    if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
    if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
    if (endpoint === 'dashboard/receipt-search?orderNo=PIKIN-20&page=1') return {
      success: true,
      data: {
        matched: true,
        inputOrderNo: 'PIKIN-20',
        matchedOrderNo: 'PIKIN-20',
        items: [{ id: 'receipt-1', orderNo: 'PIKIN-20', date: '2026-06-20T00:00:00.000Z', amount: 2500, status: 'SR_Received' }],
        pagination: { page: 1, pageSize: 10, totalItems: 11, totalPages: 2 },
      },
    };
    if (endpoint === 'dashboard/receipt-search?orderNo=PIKIN-20&page=2') return {
      success: true,
      data: {
        matched: true,
        inputOrderNo: 'PIKIN-20',
        matchedOrderNo: 'PIKIN-20',
        items: [{ id: 'receipt-2', orderNo: 'PIKIN-20', date: null, amount: 3000, status: 'RECEIVED' }],
        pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 },
      },
    };
    return { success: false };
  });

  await act(async () => {
    render(<Dashboard />);
  });

  const card = await screen.findByText('Order Receipt Search');
  const section = card.closest('.rounded-xl') || card.closest('[data-testid="dashboard-order-receipt-search-card"]') || document.body;
  const input = within(section as HTMLElement).getByLabelText('ORDER NO');
  fireEvent.change(input, { target: { value: 'PIKIN-20' } });
  fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Search' }));

  expect(await within(section as HTMLElement).findByText('Matched ORDER NO: PIKIN-20')).toBeInTheDocument();
  expect(within(section as HTMLElement).getByText('$2,500')).toBeInTheDocument();

  fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Next' }));

  expect(await within(section as HTMLElement).findByText('$3,000')).toBeInTheDocument();
  expect(mockApiCall).toHaveBeenCalledWith('dashboard/receipt-search?orderNo=PIKIN-20&page=2');
});

it('shows not found when ORDER NO matching fails', async () => {
  mockApiCall.mockImplementation(async (endpoint: string) => {
    if (endpoint === 'dashboard?action=summary') return { success: true, data: makeSummary() };
    if (endpoint === 'settings?view=user-preferences') return { success: true, data: { dashboardLayout: DEFAULT_DASHBOARD_LAYOUT } };
    if (endpoint === 'dashboard/receipt-search?orderNo=UNKNOWN-01&page=1') return {
      success: true,
      data: {
        matched: false,
        inputOrderNo: 'UNKNOWN-01',
        matchedOrderNo: null,
        items: [],
        pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
      },
    };
    return { success: false };
  });

  await act(async () => {
    render(<Dashboard />);
  });

  const card = await screen.findByTestId('dashboard-order-receipt-search-card');
  fireEvent.change(within(card).getByLabelText('ORDER NO'), { target: { value: 'UNKNOWN-01' } });
  fireEvent.keyDown(within(card).getByLabelText('ORDER NO'), { key: 'Enter', code: 'Enter' });

  expect(await within(card).findByText('ORDER NO not found')).toBeInTheDocument();
  expect(mockApiCall).toHaveBeenCalledWith('dashboard/receipt-search?orderNo=UNKNOWN-01&page=1');
});
```

Add a layout-oriented assertion that the three list cards render footer markers:

```ts
expect(screen.getAllByTestId('dashboard-card-pagination')).toHaveLength(3);
```

- [ ] **Step 2: Run failing frontend tests**

Run:

```bash
npm test -- src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand
```

Expected: FAIL because the card and pagination markers do not exist.

- [ ] **Step 3: Add UI types and state**

In `dashboard-view.tsx`, add near the dashboard types:

```ts
type DashboardReceiptSearchItem = {
  id: string;
  orderNo: string;
  date: string | null;
  amount: number;
  status: string;
};

type DashboardReceiptSearchResult = {
  matched: boolean;
  inputOrderNo: string;
  matchedOrderNo: string | null;
  items: DashboardReceiptSearchItem[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};
```

Add state inside `Dashboard()`:

```ts
const [orderReceiptSearchInput, setOrderReceiptSearchInput] = useState('');
const [orderReceiptSearchQuery, setOrderReceiptSearchQuery] = useState('');
const [orderReceiptSearchPage, setOrderReceiptSearchPage] = useState(1);
const [orderReceiptSearchResult, setOrderReceiptSearchResult] = useState<DashboardReceiptSearchResult | null>(null);
const [orderReceiptSearchLoading, setOrderReceiptSearchLoading] = useState(false);
const [orderReceiptSearchError, setOrderReceiptSearchError] = useState<string | null>(null);
```

- [ ] **Step 4: Add shared card layout helpers**

Inside `Dashboard()`, before `renderDashboardCard`, add:

```tsx
const renderPaginationFooter = (params: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPrevious: () => void;
  onNext: () => void;
}) => {
  if (params.totalItems <= 0) return <div data-testid="dashboard-card-pagination-placeholder" className="h-9" />;
  return (
    <div data-testid="dashboard-card-pagination" className="mt-auto flex items-center justify-end gap-2 pt-3 text-sm">
      <Button variant="outline" size="sm" disabled={params.page === 1} onClick={params.onPrevious}>
        {tx('上一页', 'Previous')}
      </Button>
      <span>{tx(`第 ${params.page} / ${params.totalPages} 页`, `Page ${params.page} / ${params.totalPages}`)}</span>
      <Button variant="outline" size="sm" disabled={params.page === params.totalPages} onClick={params.onNext}>
        {tx('下一页', 'Next')}
      </Button>
    </div>
  );
};
```

Change `CardContent className="space-y-3"` for released and customer cards to:

```tsx
<CardContent className="flex min-h-[520px] flex-col space-y-3">
```

Replace their existing pagination blocks with `renderPaginationFooter(...)`.

- [ ] **Step 5: Add search actions**

Add:

```ts
const loadOrderReceiptSearch = useCallback(async (orderNo: string, page: number) => {
  const trimmed = orderNo.trim();
  if (!trimmed) {
    setOrderReceiptSearchResult(null);
    setOrderReceiptSearchError(tx('请输入 ORDER NO', 'Please enter ORDER NO'));
    return;
  }
  setOrderReceiptSearchLoading(true);
  setOrderReceiptSearchError(null);
  const endpoint = `dashboard/receipt-search?orderNo=${encodeURIComponent(trimmed)}&page=${page}`;
  const result = await apiCall(endpoint);
  if (result.success && result.data) {
    setOrderReceiptSearchResult(result.data as DashboardReceiptSearchResult);
    setOrderReceiptSearchQuery(trimmed);
    setOrderReceiptSearchPage(page);
  } else {
    setOrderReceiptSearchError(tx('查询失败，请稍后重试', 'Search failed, please retry'));
  }
  setOrderReceiptSearchLoading(false);
}, [tx]);

const handleOrderReceiptSearch = () => {
  void loadOrderReceiptSearch(orderReceiptSearchInput, 1);
};
```

- [ ] **Step 6: Render the new card**

Add this branch in `renderDashboardCard` before recent cards:

```tsx
if (cardId === 'order-receipt-search') {
  const page = orderReceiptSearchResult?.pagination.page ?? orderReceiptSearchPage;
  const totalPages = orderReceiptSearchResult?.pagination.totalPages ?? 1;
  const totalItems = orderReceiptSearchResult?.pagination.totalItems ?? 0;
  return (
    <Card data-testid="dashboard-order-receipt-search-card" className="flex min-h-[520px] flex-col">
      <CardHeader>
        <CardTitle>{tx('订单收据查询', 'Order Receipt Search')}</CardTitle>
        <CardDescription>{tx('输入 ORDER NO 查询该订单对应收据', 'Search receipts by matched ORDER NO')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="dashboard-order-receipt-search-input">ORDER NO</Label>
            <Input
              id="dashboard-order-receipt-search-input"
              value={orderReceiptSearchInput}
              onChange={(event) => setOrderReceiptSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleOrderReceiptSearch();
              }}
              placeholder="PIKIN-20"
            />
          </div>
          <Button onClick={handleOrderReceiptSearch} disabled={orderReceiptSearchLoading}>
            {orderReceiptSearchLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {tx('查询', 'Search')}
          </Button>
        </div>

        {orderReceiptSearchError && (
          <Alert variant="destructive"><AlertDescription>{orderReceiptSearchError}</AlertDescription></Alert>
        )}
        {orderReceiptSearchResult && !orderReceiptSearchResult.matched && (
          <Alert variant="destructive"><AlertDescription>{tx('ORDER NO 未找到', 'ORDER NO not found')}</AlertDescription></Alert>
        )}
        {orderReceiptSearchResult?.matchedOrderNo && (
          <p className="text-sm text-muted-foreground">
            {tx(`匹配 ORDER NO：${formatOrderNameDisplay(orderReceiptSearchResult.matchedOrderNo)}`, `Matched ORDER NO: ${formatOrderNameDisplay(orderReceiptSearchResult.matchedOrderNo)}`)}
          </p>
        )}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ORDER NO</TableHead>
                <TableHead>{tx('日期', 'Date')}</TableHead>
                <TableHead>{tx('金额', 'Amount')}</TableHead>
                <TableHead>{tx('状态', 'Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orderReceiptSearchResult?.items ?? []).map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-medium">{formatOrderNameDisplay(receipt.orderNo)}</TableCell>
                  <TableCell>{receipt.date ? new Date(receipt.date).toLocaleDateString() : '-'}</TableCell>
                  <TableCell className="font-medium">{formatUsdAmount(receipt.amount)}</TableCell>
                  <TableCell><Badge>{receipt.status}</Badge></TableCell>
                </TableRow>
              ))}
              {Array.from({ length: Math.max(0, DASHBOARD_LIST_PAGE_SIZE - (orderReceiptSearchResult?.items.length ?? 0)) }).map((_, index) => (
                <TableRow key={`empty-${index}`} className="h-10"><TableCell colSpan={4}>&nbsp;</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {renderPaginationFooter({
          page,
          totalPages,
          totalItems,
          onPrevious: () => void loadOrderReceiptSearch(orderReceiptSearchQuery, Math.max(1, page - 1)),
          onNext: () => void loadOrderReceiptSearch(orderReceiptSearchQuery, Math.min(totalPages, page + 1)),
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
npm test -- src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand
```

Expected: PASS. If Testing Library cannot locate the card by `closest('.rounded-xl')`, rely on `data-testid="dashboard-order-receipt-search-card"` and update the test to use the test id.

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace/modules/dashboard/dashboard-view.tsx src/components/workspace/modules/dashboard/dashboard-view.test.tsx
git commit -m "feat: add dashboard order receipt search card"
```

---

### Task 5: Version, README, and Final Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Optional Modify: `docs/ENGINEERING_LOG.md` if present

**Interfaces:**
- Produces version `1.0.184`.
- Produces user-facing README note without technical noise.

- [ ] **Step 1: Bump version**

In `package.json`:

```json
"version": "1.0.184"
```

- [ ] **Step 2: Update README concisely**

If README has a user-facing feature list, add one bullet under Dashboard/仪表盘:

```md
- 在仪表盘可按 ORDER NO 查询对应收据记录，便于快速核对某个订单的收款情况。
```

Do not add route names, implementation details, or technical notes to README.

- [ ] **Step 3: Update engineering note only if an established file exists**

Run:

```bash
ls docs | sed -n '1,120p'
```

If `docs/ENGINEERING_LOG.md` exists, append:

```md
## 2026-06-28 Dashboard ORDER receipt search

- Added a Dashboard card for ORDER NO receipt lookup using shared order matching and receipt visibility rules.
- Standardized bottom pagination placement for Dashboard list cards.
- Tests: dashboard layout, receipt search service, receipt search API route, Dashboard UI.
```

If it does not exist, skip this step.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npm test -- src/lib/dashboard-layout-preference.test.ts src/lib/dashboard-receipt-search-service.test.ts src/app/api/dashboard/receipt-search/route.test.ts src/components/workspace/modules/dashboard/dashboard-view.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run project verification**

Run:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
```

Expected: PASS. If a command fails, stop and report the exact failing command and output before continuing.

- [ ] **Step 6: Commit docs/version**

```bash
git add package.json README.md docs/ENGINEERING_LOG.md 2>/dev/null || git add package.json README.md
git commit -m "docs: note dashboard order receipt search"
```

- [ ] **Step 7: Push and watch CI**

Run:

```bash
git status --short
git push
```

Then use GitHub Actions inspection (`gh run list`, `gh run watch`, or existing repo workflow tools) and do not stop before CI completes or fails.

- [ ] **Step 8: Rebuild only if requested**

If the user asks for local rebuild, run:

```bash
bash scripts/rebuild-local-app.sh
```

If it fails, report full error output, failed stage, exit code, relevant `docker compose logs`, and whether database/NAS/upload volumes were touched.

---

## Self-Review

**Spec coverage:**
- New Dashboard card with search box and button: Task 4.
- Search uses shared ORDER NO matching first: Task 2.
- No raw receipt search on no match: Task 2 tests and service.
- Slash composite matching through existing matcher: Task 2 test with `PIKIN-19_B/PIKIN-19B/PIKIN-21`.
- Receipt rows with ORDER NO/date/amount/status: Task 4.
- 10 rows per page: Task 2 fixed page size and Task 4 empty row reservation.
- Bottom-fixed card pagination for new and existing paginated Dashboard cards: Task 4.
- Dashboard Settings visibility/order: Task 1 registry.
- API-first automated verification: Tasks 2 and 3 plus targeted tests.
- README remains user-facing: Task 5.
- No DB/media backup change: Global Constraints.

**Placeholder scan:** No TBD/TODO/implement-later placeholders are present. Every implementation step includes exact target files, code shape, and test command.

**Type consistency:** `DashboardReceiptSearchResult`, `DashboardReceiptSearchItem`, `searchDashboardReceiptsByOrderNo`, and `order-receipt-search` are consistently named across service, API, frontend, and tests.
