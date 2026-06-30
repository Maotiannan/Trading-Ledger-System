# Customer ORDER_NAME History Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Customer Management ORDER_NAME history dialog size naturally on desktop, preserve single-line financial columns, allow ORDER breaks only after `/`, and show Receipt creation date as the leftmost Recent Receipts column.

**Architecture:** Extend the existing customer history API response with the already-selected `Receipt.createdAt`, then keep all rendering changes inside the existing history dialog. Use responsive CSS intrinsic sizing and semantic `<wbr />` opportunities rather than JavaScript measurement or narrow fixed widths.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Radix Dialog, Jest, React Testing Library, Prisma.

## Global Constraints

- Only change the Customer Management ORDER_NAME history dialog's desktop layout.
- Preserve the existing mobile layout, typography, colors, borders, radii, headings, data content, and overall visual style.
- Desktop dialog maximum width is exactly `calc(100vw - 32px)`.
- Horizontal scrolling appears only when the two tables exceed the available desktop width.
- ORDER has a minimum width comparable to `BIG ALPHA-10A` and may break only after `/`.
- INV NO, AMOUNT, O/S, CREATED AT, RECEIPT, USD, and STATUS never wrap.
- Recent Receipts column order is CREATED AT, ORDER, USD, STATUS, RECEIPT.
- `CREATED AT` uses `Receipt.createdAt`, not the receipt payment date.
- Do not add a database migration or JavaScript width measurement.

---

### Task 1: Return Receipt Creation Time From Customer History

**Files:**
- Modify: `src/lib/customer-read-service.test.ts`
- Modify: `src/lib/customer-read-service.ts`

**Interfaces:**
- Consumes: Prisma `Receipt.createdAt: Date` already selected by `getCustomerOrderNameHistory`.
- Produces: `receipts[].createdAt: string` as an ISO timestamp while preserving `receipts[].date`.

- [ ] **Step 1: Write the failing service test**

Update the existing visible-customer history fixture so payment date and creation time differ, then require both values:

```ts
date: new Date('2026-05-07T00:00:00Z'),
createdAt: new Date('2026-05-08T10:12:30Z'),
```

```ts
expect(result.data.receipts).toEqual([
  expect.objectContaining({
    id: 'receipt-1',
    date: '2026-05-07',
    createdAt: '2026-05-08T10:12:30.000Z',
  }),
]);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx jest src/lib/customer-read-service.test.ts --runInBand
```

Expected: FAIL because `createdAt` is absent from the mapped receipt response.

- [ ] **Step 3: Add the minimal response mapping**

In the receipt mapper, preserve `date` and add the ISO creation timestamp:

```ts
createdAt: row.createdAt.toISOString(),
```

- [ ] **Step 4: Run the service test and verify GREEN**

Run:

```bash
npx jest src/lib/customer-read-service.test.ts --runInBand
```

Expected: PASS.

---

### Task 2: Implement Intrinsic Desktop Dialog And Column Layout

**Files:**
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx`
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx`

**Interfaces:**
- Consumes: `CustomerOrderHistoryReceipt.createdAt: string` from Task 1.
- Produces: responsive desktop dialog layout and an internal ORDER renderer that inserts `<wbr />` after `/` without changing displayed text.

- [ ] **Step 1: Write the failing component tests**

Add a composite ORDER and creation timestamp to the fixture:

```ts
orderNo: 'BIG ALPHA-10A/BIG ALPHA-10B',
createdAt: '2026-05-08T10:12:30.000Z',
```

Require the desktop layout hooks and labels:

```ts
expect(screen.getByRole('dialog')).toHaveClass(
  'md:w-fit',
  'md:max-w-[calc(100vw-32px)]',
);
expect(screen.getByTestId('customer-order-history-scroll')).toHaveClass('md:overflow-x-auto');
expect(screen.getByTestId('customer-order-history-grid')).toHaveClass(
  'md:w-max',
  'md:grid-cols-[max-content_max-content]',
  'md:items-start',
);
expect(screen.getByText('O/S')).toBeInTheDocument();
expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
expect(screen.getByText(new Date('2026-05-08T10:12:30.000Z').toLocaleDateString())).toBeInTheDocument();
expect(document.querySelectorAll('wbr')).not.toHaveLength(0);
```

Within the Recent Receipts table, assert the exact header order:

```ts
const recentTable = screen.getByTestId('customer-order-history-receipts-table');
expect(within(recentTable).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
  'CREATED AT',
  'ORDER',
  'USD',
  'STATUS',
  'RECEIPT',
]);
```

Assert the non-ORDER headers and cells use `whitespace-nowrap`, and the ORDER cells use `min-w-[13ch]` without `break-words`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx jest src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx --runInBand
```

Expected: FAIL because the dialog still uses `max-w-6xl`, fixed tables, wrapping financial columns, the old heading/order, and no creation-time cell.

- [ ] **Step 3: Implement the ORDER break renderer**

Add a small local renderer that preserves text and inserts optional break points only after `/`:

```tsx
function OrderNoText({ value }: { value: string | null }) {
  const text = formatOrderNameDisplay(value);
  const parts = text.split('/');

  return parts.map((part, index) => (
    <span key={`${part}-${index}`} className="whitespace-nowrap">
      {index > 0 && '/'}{part}
      {index < parts.length - 1 && <wbr />}
    </span>
  ));
}
```

- [ ] **Step 4: Implement the responsive dialog structure**

Use responsive intrinsic sizing while retaining the current mobile classes:

```tsx
<DialogContent className="flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-6xl flex-col p-4 sm:p-6 md:w-fit md:max-w-[calc(100vw-32px)]">
```

Wrap only the completed table area:

```tsx
<div data-testid="customer-order-history-scroll" className="md:min-w-0 md:overflow-x-auto">
  <div
    data-testid="customer-order-history-grid"
    className="grid gap-4 md:w-max md:min-w-full md:grid-cols-[max-content_max-content] md:items-start"
  >
```

Use `md:w-max` and `md:table-auto` on both tables. Remove `table-fixed`, `whitespace-normal`, and `break-words`. Apply `whitespace-nowrap` to all non-ORDER columns; apply `min-w-[13ch]` to ORDER headers and cells and render them with `OrderNoText`.

- [ ] **Step 5: Add creation time and reorder Recent Receipts**

Extend the UI type:

```ts
createdAt: string;
```

Render columns in this order:

```tsx
<TableHead>CREATED AT</TableHead>
<TableHead className="min-w-[13ch]">ORDER</TableHead>
<TableHead>USD</TableHead>
<TableHead>STATUS</TableHead>
<TableHead>RECEIPT</TableHead>
```

Render creation date exactly as Receipt Management does:

```tsx
<TableCell className="whitespace-nowrap">
  {new Date(receipt.createdAt).toLocaleDateString()}
</TableCell>
```

Rename the Historical Orders column heading to `O/S`, move the receipt number cell to the last Recent Receipts column, and change the empty row `colSpan` from `4` to `5`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npx jest src/lib/customer-read-service.test.ts src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx --runInBand
```

Expected: both suites PASS.

---

### Task 3: Version, Verification, Git, And CI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed API and dialog changes from Tasks 1-2.
- Produces: application version `1.0.188`, verified source, pushed commit, and completed CI run.

- [ ] **Step 1: Bump the single application version**

Run:

```bash
npm version 1.0.188 --no-git-tag-version
```

Update the README version line from `1.0.187` to `1.0.188`; do not add technical implementation detail to README.

- [ ] **Step 2: Run static and focused verification**

Run:

```bash
npm run lint
npm run typecheck
npx prisma validate
npx jest src/lib/customer-read-service.test.ts src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx --runInBand
npm run build
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm test -- --runInBand
```

Expected: all suites PASS with zero failed tests.

- [ ] **Step 4: Commit and push**

Run:

```bash
git add src/lib/customer-read-service.ts \
  src/lib/customer-read-service.test.ts \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.tsx \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx \
  package.json package-lock.json README.md \
  docs/superpowers/plans/2026-06-30-customer-order-history-desktop-layout.md
git commit -m "fix: refine customer order history layout"
git push origin main
```

- [ ] **Step 5: Watch GitHub Actions to completion**

Find the run for the pushed commit and wait for its final result:

```bash
gh run list --commit "$(git rev-parse HEAD)" --limit 5
gh run watch <run-id> --exit-status
```

Expected: CI concludes `success`.

- [ ] **Step 6: Preserve the local running service until approved**

Do not rebuild Docker automatically for this desktop layout change. Report completion and ask whether to run the project's backup-first `scripts/rebuild-local-app.sh` workflow.
