# Receipt Global Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Receipt Management's custom pagination with the shared pagination component, using account-persisted `5 / 10 / 20 / 50` options and a default of `20` receipts per page.

**Architecture:** Extend the existing JSON-backed `UserListPageSizePreference` with a `receipt` key, so no database schema or migration is needed. Receipt Management will consume the existing `useListPageSizePreference` hook and render the existing `ListPagination` component instead of maintaining a duplicate selector and previous/next UI.

**Tech Stack:** Next.js 16, React 19, TypeScript, Jest, Testing Library, Prisma JSON user preferences.

## Global Constraints

- Receipt page-size options are exactly `5 / 10 / 20 / 50`.
- Receipt default page size is exactly `20`.
- The selected Receipt page size follows the current account.
- The page-size select, previous arrow, page summary, and next arrow stay on one non-wrapping row on mobile.
- No database table, migration, NAS path, COS path, or business receipt data changes.
- Do not rebuild Docker until the user explicitly requests it after code verification.

---

### Task 1: Extend The Account Pagination Preference

**Files:**
- Modify: `src/lib/list-page-size-preference.ts`
- Modify: `src/lib/user-preference-service.test.ts`
- Modify: `src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx`
- Modify: `src/components/workspace/modules/details/detail-manager.test.tsx`
- Modify: `src/components/workspace/modules/swifts/swift-manager.test.tsx`

**Interfaces:**
- Consumes: existing `LIST_PAGE_SIZE_OPTIONS`, `normalizeListPageSizePreference`, and JSON-backed `UserPreference.listPageSizes`.
- Produces: `UserListPageSizePreference.receipt: ListPageSizeOption` with default `20`.

- [ ] **Step 1: Write failing preference tests**

Update preference expectations so normalized and validated values include:

```ts
{
  detail: 10,
  swift: 10,
  receipt: 20,
}
```

When existing stored JSON omits `receipt`, assert normalization adds `receipt: 20`. When saving another page's preference, assert the request preserves `receipt: 20`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx jest src/lib/user-preference-service.test.ts src/components/workspace/modules/settings/hooks/use-settings-actions.test.tsx src/components/workspace/modules/details/detail-manager.test.tsx src/components/workspace/modules/swifts/swift-manager.test.tsx --runInBand --testPathIgnorePatterns='/node_modules/' '/.next/' '/tests/e2e/'
```

Expected: failures show that `receipt` is missing from normalized defaults or saved preference payloads.

- [ ] **Step 3: Add the preference key and default**

Change the shared type and default to:

```ts
export type UserListPageSizePreference = {
  detail: ListPageSizeOption;
  swift: ListPageSizeOption;
  receipt: ListPageSizeOption;
};

export const DEFAULT_USER_LIST_PAGE_SIZE_PREFERENCE = Object.freeze({
  detail: DEFAULT_LIST_PAGE_SIZE,
  swift: DEFAULT_LIST_PAGE_SIZE,
  receipt: 20,
});
```

Extend `normalizeListPageSizePreference` to normalize `receipt` through the same option validator. No Prisma migration is required because `listPageSizes` is already a JSON column.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all selected suites pass with zero failures.

### Task 2: Replace Receipt's Duplicate Pagination UI

**Files:**
- Modify: `src/components/workspace/modules/receipts/components/receipt-list.test.tsx`
- Modify: `src/components/workspace/modules/receipts/components/receipt-list.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.test.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`

**Interfaces:**
- Consumes: `ListPagination` and `useListPageSizePreference('receipt')`.
- Produces: Receipt pagination with the same controls, mobile layout, and persistence behavior as Detail and SWIFT.

- [ ] **Step 1: Write failing Receipt tests**

Assert that `ReceiptList` renders `ListPagination` behavior with arrows and compact summary:

```ts
expect(screen.getByLabelText('每页条数')).toHaveValue('20');
expect(screen.getByRole('button', { name: '上一页' })).toHaveTextContent('←');
expect(screen.getByText('1 / 2 (21)')).toBeInTheDocument();
expect(screen.getByTestId('list-pagination-content')).toHaveClass('flex-row', 'flex-nowrap');
```

In `ReceiptManager`, mock user preferences as `{ detail: 10, swift: 10, receipt: 20 }`, change the select to `50`, and assert the settings request contains:

```ts
preferences: {
  listPageSizes: { detail: 10, swift: 10, receipt: 50 },
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx jest src/components/workspace/modules/receipts/components/receipt-list.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx --runInBand --testPathIgnorePatterns='/node_modules/' '/.next/' '/tests/e2e/'
```

Expected: failures show the old visible Previous/Next labels, old page sizes, and missing persisted Receipt preference.

- [ ] **Step 3: Reuse the shared component and hook**

In `ReceiptList`, remove the local pagination markup and render:

```tsx
<ListPagination
  idPrefix="receipt"
  tx={tx}
  currentPage={currentPage}
  totalPages={totalPages}
  totalCount={receipts.length}
  pageSize={pageSize}
  pageSizeOptions={pageSizeOptions}
  onPreviousPage={onPreviousPage}
  onNextPage={onNextPage}
  onPageSizeChange={onPageSizeChange}
/>
```

In `ReceiptManager`, replace the local `pageSize` state and `receiptPageSizeOptions` constant with:

```ts
const { pageSize, pageSizeOptions, savePageSize } = useListPageSizePreference('receipt');
```

Keep resetting `currentPage` to `1` when `savePageSize` is called.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: both suites pass with zero failures.

### Task 3: Release Metadata And Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`

**Interfaces:**
- Consumes: verified Receipt pagination implementation.
- Produces: synchronized version, user-facing release note, engineering trace, Git commit, and pushed CI run.

- [ ] **Step 1: Update version and documentation**

Run `npm version 1.0.190 --no-git-tag-version`. Add a concise README note stating that Receipt pagination now uses the shared account-level `5 / 10 / 20 / 50` control with default `20`. Record test scope and the absence of database/NAS/COS changes in `ENGINEERING_LOG.md`.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Expected: all commands exit `0` with no test failures, type errors, lint errors, build errors, or whitespace errors.

- [ ] **Step 3: Commit and push**

```bash
git add src package.json package-lock.json README.md ENGINEERING_LOG.md docs/superpowers
git commit -m "feat: unify receipt pagination"
git push origin main
```

- [ ] **Step 4: Watch GitHub Actions**

Find the run for the pushed commit with `gh run list --commit <sha>` and run `gh run watch <run-id> --exit-status`. Expected: conclusion `success`.

- [ ] **Step 5: Stop before Docker rebuild**

Report verified source/CI status and ask whether the user wants the local Docker service rebuilt. Do not invoke `scripts/rebuild-local-app.sh` without that confirmation.
