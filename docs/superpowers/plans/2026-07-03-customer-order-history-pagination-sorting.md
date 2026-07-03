# Customer ORDER_NAME History Sorting And Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Sort customer historical orders by the confirmed balance/release/ship rules, sort receipts by creation time, and add independent account-persisted pagination to both history tables.

**Architecture:** Add a focused pure module for customer-history sorting and pagination normalization, then keep customer visibility and ORDER_NAME matching in the existing read service. Extend the existing customer history API with two independent page parameter sets, reuse the existing JSON user preference, and add a compact mode to the shared pagination component for the responsive dialog.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/MySQL, Jest, React Testing Library, Tailwind CSS.

## Global Constraints

- Historical orders with `O/S <= 10` always appear after every order with `O/S > 10`.
- Within each balance group: both dates empty first by `O/S` descending; release-dated rows next by `RELEASE DATE` descending; ship-only rows last by `SHIP DATE` descending.
- Recent receipts sort by `Receipt.createdAt` descending.
- Historical Orders and Recent Receipts persist independent account-level page sizes.
- Both tables default to `10` rows and allow only `5`, `10`, `15`, or `20`.
- Existing Receipt, Payment Detail, and SWIFT page-size choices must not gain `15`.
- Existing customer visibility, ORDER_NAME matching, table columns, typography, colors, and desktop two-column layout remain unchanged.
- No Prisma migration, backup scope change, Docker rebuild, or live data operation is required during implementation.

---

## File Structure

- Create `src/lib/customer-order-history-pagination.ts`: pure business sorting, page normalization, and array slicing.
- Create `src/lib/customer-order-history-pagination.test.ts`: exhaustive comparator and pagination tests.
- Modify `src/lib/customer-read-service.ts`: select invoice dates, apply the pure sorter, paginate orders, and query paginated receipts.
- Modify `src/lib/customer-read-service.test.ts`: service query, sorting, receipt paging, and metadata tests.
- Modify `src/app/api/customer/route.ts`: read account defaults and pass both request pagination sets to the service.
- Create `src/app/api/customer/route.test.ts`: API parameter/default forwarding tests.
- Modify `src/lib/list-page-size-preference.ts`: add two customer-history preference keys with per-key allowed values.
- Modify `src/lib/list-page-size-preference.test.ts`: normalization and validation coverage.
- Modify `src/components/workspace/modules/shared/use-list-page-size-preference.ts`: expose key-specific options and save errors.
- Create `src/components/workspace/modules/shared/use-list-page-size-preference.test.tsx`: persistence and failure tests.
- Modify `src/components/workspace/modules/shared/list-pagination.tsx`: compact embedded mode and disabled state.
- Modify `src/components/workspace/modules/shared/list-pagination.test.tsx`: compact one-row and disabled-control tests.
- Modify `src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx`: render two independent compact pagers.
- Modify `src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx`: table, pager, and responsive layout tests.
- Modify `src/components/workspace/modules/customers/customer-manager.tsx`: independent pagination state, guarded loading, and callbacks.
- Modify `src/components/workspace/modules/customers/customer-manager.test.tsx`: request URL and independent state tests.
- Modify `README.md`, `ENGINEERING_LOG.md`, `package.json`, and `package-lock.json`: concise user release note, engineering record, and version `1.0.191`.

---

### Task 1: Pure Historical Order Sorting And Pagination

**Files:**
- Create: `src/lib/customer-order-history-pagination.ts`
- Create: `src/lib/customer-order-history-pagination.test.ts`

**Interfaces:**
- Produces: `CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS`, `CustomerHistoryPagination`, `normalizeCustomerHistoryPagination()`, `sortCustomerHistoryOrders()`, and `paginateCustomerHistoryRows()`.
- Consumes: plain values only; this module must not import Prisma or access the database.

- [x] **Step 1: Write failing sorting and pagination tests**

Create test rows covering both balance groups and all three date subgroups:

```ts
import {
  normalizeCustomerHistoryPagination,
  paginateCustomerHistoryRows,
  sortCustomerHistoryOrders,
} from './customer-order-history-pagination';

describe('customer order history pagination', () => {
  it('sorts each balance group by empty dates, release date, then ship date', () => {
    const rows = [
      { id: 'low-release', outstanding: 5, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-30'), createdAt: new Date('2026-06-01') },
      { id: 'active-ship', outstanding: 50, amount: 100, shipDate: new Date('2026-06-20'), releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-empty-small', outstanding: 20, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-release-old', outstanding: 30, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-10'), createdAt: new Date('2026-06-01') },
      { id: 'low-empty', outstanding: 8, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
      { id: 'active-release-new', outstanding: 40, amount: 100, shipDate: new Date('2026-01-01'), releaseDate: new Date('2026-06-25'), createdAt: new Date('2026-06-01') },
      { id: 'active-empty-large', outstanding: 90, amount: 100, shipDate: null, releaseDate: null, createdAt: new Date('2026-06-01') },
    ];

    expect(sortCustomerHistoryOrders(rows).map((row) => row.id)).toEqual([
      'active-empty-large',
      'active-empty-small',
      'active-release-new',
      'active-release-old',
      'active-ship',
      'low-empty',
      'low-release',
    ]);
  });

  it('normalizes invalid input and clamps pages after slicing', () => {
    expect(normalizeCustomerHistoryPagination(
      { page: '0', pageSize: '999' },
      { defaultPageSize: 15 },
    )).toEqual({ page: 1, pageSize: 15 });

    expect(paginateCustomerHistoryRows(['a', 'b', 'c'], 9, 2)).toEqual({
      items: ['c'],
      pagination: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2 },
    });
  });
});
```

- [x] **Step 2: Run the new tests and verify failure**

Run:

```bash
npx jest src/lib/customer-order-history-pagination.test.ts --runInBand
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the pure module**

Implement the confirmed comparator with stable tie breakers:

```ts
export const CUSTOMER_HISTORY_PAGE_SIZE_OPTIONS = [5, 10, 15, 20] as const;
export const DEFAULT_CUSTOMER_HISTORY_PAGE_SIZE = 10;

export type CustomerHistoryPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type SortableHistoryOrder = {
  id: string;
  outstanding: number;
  shipDate: Date | string | null;
  releaseDate: Date | string | null;
  createdAt: Date | string;
};

function timestamp(value: Date | string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function dateGroup(row: SortableHistoryOrder): 0 | 1 | 2 {
  if (timestamp(row.releaseDate) !== null) return 1;
  if (timestamp(row.shipDate) !== null) return 2;
  return 0;
}

export function sortCustomerHistoryOrders<T extends SortableHistoryOrder>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const balanceGroup = Number(left.outstanding <= 10) - Number(right.outstanding <= 10);
    if (balanceGroup !== 0) return balanceGroup;

    const leftDateGroup = dateGroup(left);
    const rightDateGroup = dateGroup(right);
    if (leftDateGroup !== rightDateGroup) return leftDateGroup - rightDateGroup;

    if (leftDateGroup === 0 && left.outstanding !== right.outstanding) {
      return right.outstanding - left.outstanding;
    }
    if (leftDateGroup === 1) {
      const dateDiff = (timestamp(right.releaseDate) || 0) - (timestamp(left.releaseDate) || 0);
      if (dateDiff !== 0) return dateDiff;
    }
    if (leftDateGroup === 2) {
      const dateDiff = (timestamp(right.shipDate) || 0) - (timestamp(left.shipDate) || 0);
      if (dateDiff !== 0) return dateDiff;
    }

    const createdDiff = (timestamp(right.createdAt) || 0) - (timestamp(left.createdAt) || 0);
    return createdDiff || left.id.localeCompare(right.id);
  });
}
```

Add normalization and clamped slicing. Invalid page size must use the supplied account default only when that default is one of `5/10/15/20`; otherwise use `10`.

- [x] **Step 4: Run tests and verify pass**

Run:

```bash
npx jest src/lib/customer-order-history-pagination.test.ts --runInBand
```

Expected: PASS.

- [x] **Step 5: Commit the pure business unit**

```bash
git add src/lib/customer-order-history-pagination.ts src/lib/customer-order-history-pagination.test.ts
git commit -m "feat: add customer history sorting rules"
```

---

### Task 2: Server-Side Customer History Pagination

**Files:**
- Modify: `src/lib/customer-read-service.ts`
- Modify: `src/lib/customer-read-service.test.ts`
- Modify: `src/app/api/customer/route.ts`
- Create: `src/app/api/customer/route.test.ts`

**Interfaces:**
- Consumes: Task 1 sorting and pagination helpers.
- Consumes: `getUserPreferences(currentUser).listPageSizes.customerHistoryOrders` and `.customerHistoryReceipts`.
- Produces: `data.orders`, `data.orderPagination`, `data.receipts`, and `data.receiptPagination`.

- [x] **Step 1: Extend service tests with invoice dates, receipt count, and metadata**

Add `receipt.count` to the mocked database and assert:

```ts
expect(result.data.orderPagination).toEqual({
  page: 1,
  pageSize: 10,
  totalItems: 1,
  totalPages: 1,
});
expect(result.data.receiptPagination).toEqual({
  page: 1,
  pageSize: 10,
  totalItems: 2,
  totalPages: 1,
});
expect(mockDb.receipt.findMany).toHaveBeenCalledWith(expect.objectContaining({
  orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  skip: 0,
  take: 10,
}));
```

Add a service case with more than one order page and assert the final order IDs match Task 1's business ordering before slicing.

- [x] **Step 2: Run service tests and verify failure**

Run:

```bash
npx jest src/lib/customer-read-service.test.ts --runInBand
```

Expected: FAIL because pagination metadata, invoice dates, and receipt count paging are absent.

- [x] **Step 3: Extend `getCustomerOrderNameHistory`**

Change the input to accept:

```ts
type CustomerHistoryRequest = {
  customerId: string;
  orderName: string;
  orderPage?: unknown;
  orderPageSize?: unknown;
  receiptPage?: unknown;
  receiptPageSize?: unknown;
  defaultOrderPageSize?: number;
  defaultReceiptPageSize?: number;
};
```

Select sorting fields:

```ts
invoice: {
  select: {
    invNo: true,
    shipDate: true,
    releaseDate: true,
  },
},
```

After existing ORDER_NAME filtering, map internal sortable rows, call `sortCustomerHistoryOrders()`, then call `paginateCustomerHistoryRows()`. Remove internal date and creation fields from the public order rows.

For receipts:

1. Count visible customer receipts.
2. Normalize and clamp `receiptPage`.
3. Query only the current page with `skip`, `take`, and `orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]`.
4. Return both pagination objects.

- [x] **Step 4: Add an API route test for account defaults and request overrides**

Mock `withAuth`, `getCustomerOrderNameHistory`, and `getUserPreferences`. Verify:

```ts
mockGetUserPreferences.mockResolvedValueOnce({
  listPageSizes: {
    detail: 10,
    swift: 10,
    receipt: 20,
    customerHistoryOrders: 15,
    customerHistoryReceipts: 5,
  },
});

await GET({
  nextUrl: new URL(
    'http://localhost/api/customer?action=order-history'
    + '&customerId=customer-1&orderName=MAB-1'
    + '&orderPage=2&receiptPage=3&receiptPageSize=20',
  ),
  headers: { get: () => null },
} as never);

expect(mockGetCustomerOrderNameHistory).toHaveBeenCalledWith(
  expect.objectContaining({ id: 'admin-1' }),
  expect.objectContaining({
    customerId: 'customer-1',
    orderName: 'MAB-1',
    orderPage: '2',
    orderPageSize: null,
    receiptPage: '3',
    receiptPageSize: '20',
    defaultOrderPageSize: 15,
    defaultReceiptPageSize: 5,
  }),
);
```

- [x] **Step 5: Update the customer route**

In the `action === 'order-history'` branch:

1. Load current account preferences.
2. Forward all four raw query values.
3. Forward the two account default page sizes.
4. Keep existing authentication and customer access checks unchanged.

- [x] **Step 6: Run service and route tests**

Run:

```bash
npx jest src/lib/customer-read-service.test.ts src/app/api/customer/route.test.ts --runInBand
```

Expected: PASS.

- [x] **Step 7: Commit the API deliverable**

```bash
git add src/lib/customer-read-service.ts src/lib/customer-read-service.test.ts src/app/api/customer/route.ts src/app/api/customer/route.test.ts
git commit -m "feat: paginate customer order history API"
```

---

### Task 3: Independent Account Page-Size Preferences

**Files:**
- Modify: `src/lib/list-page-size-preference.ts`
- Modify: `src/lib/list-page-size-preference.test.ts`
- Modify: `src/components/workspace/modules/shared/use-list-page-size-preference.ts`
- Create: `src/components/workspace/modules/shared/use-list-page-size-preference.test.tsx`

**Interfaces:**
- Produces: preference keys `customerHistoryOrders` and `customerHistoryReceipts`.
- Produces: `getListPageSizeOptions(key)` so existing consumers retain `5/10/20/50`.
- Produces: `useListPageSizePreference(key)` result with `pageSize`, `pageSizeOptions`, `savePageSize`, and `saveError`.

- [x] **Step 1: Write failing preference model tests**

Assert exact defaults and per-key options:

```ts
expect(DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE).toEqual({
  detail: 10,
  swift: 10,
  receipt: 20,
  customerHistoryOrders: 10,
  customerHistoryReceipts: 10,
});
expect(getListPageSizeOptions('detail')).toEqual([5, 10, 20, 50]);
expect(getListPageSizeOptions('customerHistoryOrders')).toEqual([5, 10, 15, 20]);
expect(validateListPageSizePreference({
  customerHistoryOrders: 15,
  customerHistoryReceipts: 20,
})).toEqual(expect.objectContaining({
  customerHistoryOrders: 15,
  customerHistoryReceipts: 20,
}));
expect(() => validateListPageSizePreference({
  customerHistoryOrders: 50,
})).toThrow('Invalid list page size for customerHistoryOrders');
```

- [x] **Step 2: Run model tests and verify failure**

Run:

```bash
npx jest src/lib/list-page-size-preference.test.ts --runInBand
```

Expected: FAIL because the new keys and key-specific options do not exist.

- [x] **Step 3: Implement per-key option validation**

Keep existing options unchanged and add:

```ts
export const CUSTOMER_HISTORY_LIST_PAGE_SIZE_OPTIONS = [5, 10, 15, 20] as const;

export type UserListPageSizePreference = {
  detail: number;
  swift: number;
  receipt: number;
  customerHistoryOrders: number;
  customerHistoryReceipts: number;
};

const PAGE_SIZE_OPTIONS_BY_KEY = {
  detail: LIST_PAGE_SIZE_OPTIONS,
  swift: LIST_PAGE_SIZE_OPTIONS,
  receipt: LIST_PAGE_SIZE_OPTIONS,
  customerHistoryOrders: CUSTOMER_HISTORY_LIST_PAGE_SIZE_OPTIONS,
  customerHistoryReceipts: CUSTOMER_HISTORY_LIST_PAGE_SIZE_OPTIONS,
} as const;

export function getListPageSizeOptions(key: keyof UserListPageSizePreference): readonly number[] {
  return PAGE_SIZE_OPTIONS_BY_KEY[key];
}
```

Normalize and validate each key against its own option list.

- [x] **Step 4: Write hook tests for loading, saving, and failed persistence**

Mock `apiCall`. Assert the hook:

- loads `15` for `customerHistoryOrders`
- exposes `[5, 10, 15, 20]`
- saves the complete preference object
- keeps the local value and exposes a readable error after a failed save

- [x] **Step 5: Update the shared hook**

Use `getListPageSizeOptions(key)` instead of the global option constant. Add a `saveError` state:

```ts
const [saveError, setSaveError] = useState('');

const savePageSize = useCallback((nextPageSize: number) => {
  setSaveError('');
  // existing optimistic update
  void apiCall('settings', request)
    .then((result) => {
      if (!result.success) {
        setSaveError(String(result.message || result.error || 'Failed to save page size setting.'));
        return;
      }
      // existing saved normalization
    })
    .catch(() => {
      setSaveError('Failed to save page size setting.');
    });
}, [key, listPageSizes]);
```

Existing Detail, SWIFT, and Receipt call sites do not need behavior changes.

- [x] **Step 6: Run preference tests**

Run:

```bash
npx jest src/lib/list-page-size-preference.test.ts src/components/workspace/modules/shared/use-list-page-size-preference.test.tsx --runInBand
```

Expected: PASS.

- [x] **Step 7: Commit preference support**

```bash
git add src/lib/list-page-size-preference.ts src/lib/list-page-size-preference.test.ts src/components/workspace/modules/shared/use-list-page-size-preference.ts src/components/workspace/modules/shared/use-list-page-size-preference.test.tsx
git commit -m "feat: persist customer history page sizes"
```

---

### Task 4: Compact Shared Pagination Mode

**Files:**
- Modify: `src/components/workspace/modules/shared/list-pagination.tsx`
- Modify: `src/components/workspace/modules/shared/list-pagination.test.tsx`

**Interfaces:**
- Produces: optional props `compact?: boolean` and `disabled?: boolean`.
- Existing callers without these props preserve the current card presentation.

- [x] **Step 1: Add failing compact-mode tests**

Render:

```tsx
<ListPagination
  idPrefix="history-orders"
  tx={tx}
  currentPage={1}
  totalPages={2}
  totalCount={15}
  pageSize={10}
  pageSizeOptions={[5, 10, 15, 20]}
  compact
  disabled
  onPreviousPage={jest.fn()}
  onNextPage={jest.fn()}
  onPageSizeChange={jest.fn()}
/>
```

Assert:

- the root has `flex-nowrap` and compact padding
- there is no nested Card
- select and both buttons are disabled
- summary remains `1 / 2 (15)`

- [x] **Step 2: Run component test and verify failure**

Run:

```bash
npx jest src/components/workspace/modules/shared/list-pagination.test.tsx --runInBand
```

Expected: FAIL because compact and disabled props do not exist.

- [x] **Step 3: Implement a shared controls body**

Extract the existing select/buttons into one internal controls element. Return:

```tsx
if (compact) {
  return (
    <div
      data-testid="list-pagination-content"
      className="flex flex-row flex-nowrap items-center justify-center gap-1.5 py-2"
    >
      {controls}
    </div>
  );
}

return (
  <Card>
    <CardContent
      data-testid="list-pagination-content"
      className="flex flex-row flex-nowrap items-center justify-center gap-2 px-4 py-4"
    >
      {controls}
    </CardContent>
  </Card>
);
```

Apply `disabled` to the select and combine it with the existing first/last-page button conditions.

- [x] **Step 4: Run shared pagination tests**

Run:

```bash
npx jest src/components/workspace/modules/shared/list-pagination.test.tsx --runInBand
```

Expected: PASS with both legacy and compact cases.

- [x] **Step 5: Commit the reusable UI unit**

```bash
git add src/components/workspace/modules/shared/list-pagination.tsx src/components/workspace/modules/shared/list-pagination.test.tsx
git commit -m "feat: add compact shared pagination mode"
```

---

### Task 5: Customer History Dialog And State Integration

**Files:**
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx`
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx`
- Modify: `src/components/workspace/modules/customers/customer-manager.tsx`
- Modify: `src/components/workspace/modules/customers/customer-manager.test.tsx`

**Interfaces:**
- Consumes: API pagination metadata from Task 2.
- Consumes: preference keys and hook error from Task 3.
- Consumes: compact pagination mode from Task 4.
- Produces: independently paged Historical Orders and Recent Receipts tables.

- [x] **Step 1: Extend dialog types and write failing rendering tests**

Add:

```ts
export type CustomerOrderHistoryPagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type CustomerOrderHistory = {
  orders: CustomerOrderHistoryOrder[];
  orderPagination: CustomerOrderHistoryPagination;
  receipts: CustomerOrderHistoryReceipt[];
  receiptPagination: CustomerOrderHistoryPagination;
};
```

Extend dialog props with:

```ts
pageSizeOptions: readonly number[];
preferenceError: string;
onOrderPageChange: (page: number) => void;
onOrderPageSizeChange: (pageSize: number) => void;
onReceiptPageChange: (page: number) => void;
onReceiptPageSizeChange: (pageSize: number) => void;
```

Assert two compact pagination controls render, contain `[5, 10, 15, 20]`, invoke only their own callbacks, and keep the existing table header order and desktop layout classes.

- [x] **Step 2: Run dialog tests and verify failure**

Run:

```bash
npx jest src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx --runInBand
```

Expected: FAIL because the dialog does not render pagination.

- [x] **Step 3: Render independent compact pagers**

Place one `ListPagination compact` immediately below each table. Use that list's metadata and callbacks. Pass `disabled={loading}`. Render a localized warning Alert when `preferenceError` is non-empty.

Do not change existing table columns, wrapping rules, colors, or desktop grid classes.

- [x] **Step 4: Replace one-shot manager loading with guarded paged loading**

Add two preference hooks:

```ts
const orderHistoryOrdersPageSize = useListPageSizePreference('customerHistoryOrders');
const orderHistoryReceiptsPageSize = useListPageSizePreference('customerHistoryReceipts');
```

Store:

```ts
const [orderHistoryTarget, setOrderHistoryTarget] = useState<{ customerId: string; orderName: string } | null>(null);
const [orderHistoryOrderPage, setOrderHistoryOrderPage] = useState(1);
const [orderHistoryReceiptPage, setOrderHistoryReceiptPage] = useState(1);
const orderHistoryRequestGuard = useLatestRequestGuard();
```

Create a single loader that receives all four page values and builds:

```ts
const query = new URLSearchParams({
  action: 'order-history',
  customerId: target.customerId,
  orderName: target.orderName,
  orderPage: String(orderPage),
  orderPageSize: String(orderPageSize),
  receiptPage: String(receiptPage),
  receiptPageSize: String(receiptPageSize),
});
```

Rules:

- opening a target sets both pages to one and clears old rows only for the initial load
- paging retains current rows while loading
- changing one page size resets only that list to page one and saves only that preference
- a request token prevents stale results replacing a newer target/page
- closing clears target, history, error, and both page numbers

- [x] **Step 5: Upgrade manager tests to capture dialog props**

Replace the null dialog mock with one that records props. Assert:

1. Opening history requests page one with both persisted sizes.
2. `onOrderPageChange(2)` changes only `orderPage`.
3. `onReceiptPageSizeChange(15)` sends receipt page one and leaves the order page unchanged.
4. Failed preference persistence is passed as a readable warning.

- [x] **Step 6: Run customer UI tests**

Run:

```bash
npx jest \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx \
  src/components/workspace/modules/customers/customer-manager.test.tsx \
  --runInBand
```

Expected: PASS.

- [x] **Step 7: Commit the integrated feature**

```bash
git add src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx src/components/workspace/modules/customers/customer-manager.tsx src/components/workspace/modules/customers/customer-manager.test.tsx
git commit -m "feat: paginate customer order history dialog"
```

---

### Task 6: Release Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: all completed feature tasks.
- Produces: release version `1.0.191` and reproducible verification evidence.

- [x] **Step 1: Update the version from its single source**

Run:

```bash
npm version 1.0.191 --no-git-tag-version
```

Expected: `package.json` and `package-lock.json` both contain `1.0.191`.

- [x] **Step 2: Keep README user-facing and concise**

Update only the current version section:

```md
- 版本：`1.0.191`
- 最近更新：客户 ORDER_NAME 历史按业务日期和余额排序，历史订单与最近收据支持独立分页并记住账号选择。
```

Do not add implementation details to README.

- [x] **Step 3: Record engineering details**

Add an `ENGINEERING_LOG.md` entry containing:

- confirmed sorting precedence
- independent API pagination
- account-level `5/10/15/20` preferences
- compact mobile pagination
- test commands and outcomes
- explicit statement that there is no schema migration, NAS/COS path change, or backup scope change

- [x] **Step 4: Run focused tests**

Run:

```bash
npx jest \
  src/lib/customer-order-history-pagination.test.ts \
  src/lib/customer-read-service.test.ts \
  src/app/api/customer/route.test.ts \
  src/lib/list-page-size-preference.test.ts \
  src/components/workspace/modules/shared/use-list-page-size-preference.test.tsx \
  src/components/workspace/modules/shared/list-pagination.test.tsx \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx \
  src/components/workspace/modules/customers/customer-manager.test.tsx \
  --runInBand
```

Expected: all focused suites PASS.

- [x] **Step 5: Run project gates**

Run each command separately and preserve complete failure output:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Expected: all commands exit `0`.

- [x] **Step 6: Inspect the final diff and data boundary**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- prisma prisma/migrations docker-compose.yml docs/backup
```

Expected:

- no whitespace errors
- no unexpected files
- no Prisma schema, migration, Docker persistence, NAS/COS, or backup documentation changes

- [x] **Step 7: Commit the release metadata**

```bash
git add README.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "docs: release customer history pagination"
```

- [x] **Step 8: Report before deployment**

Report:

- exact tests and build results
- final commits
- whether the branch is ahead of `origin/main`
- confirmation that no live database, Docker volume, or NAS path was touched

Ask the user whether to run the safe local rebuild and push workflow. Do not rebuild or push before confirmation.
