# Dashboard Live Order Balance Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Dashboard and balance-writing paths use a single backend balance source of truth, automatically correct stale `Order.orderBalance` cache values, and preserve an audit/log trail without adding a manual repair button.

**Architecture:** Add a pure order-balance kernel, wrap it with a persistence service for automatic cache repair, then refactor Dashboard and balance update paths to use that service. Dashboard computes visible order balances once on the backend and reuses the same computed values for totals, customer ranking, and released invoice details.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/MySQL, Jest, existing logger/audit infrastructure.

## Global Constraints

- Balance calculation must happen on the backend only.
- Frontend must display API-provided balances and must not compute finance balances from raw receipt rows.
- `Order.orderBalance` is only a cache; Dashboard must display computed live balance when cache differs.
- Formula: `Order.amount - sum(Receipt.usd for linked receipts where status !== SIGNING_PENDING)`.
- `SIGNING_PENDING` does not deduct balance.
- `SR_Received`, `Waiting_SWIFT`, `Bank_Transfer`, and `RECEIVED` deduct balance.
- No manual POST repair button/API is allowed.
- Cache mismatches are automatically repaired and recorded in structured logs/audit only.
- Dashboard should not show a user-facing warning for repaired cache mismatches.
- No Prisma migration, uploaded media path, or backup scope change is expected.

---

## File Structure

- Create `src/lib/order-balance.ts`: pure receipt inclusion, balance computation, money comparison, and mismatch result helpers.
- Create `src/lib/order-balance.test.ts`: formula, status, precision, and mismatch tests.
- Create `src/lib/order-balance-service.ts`: database-backed recompute/update/audit/log service.
- Create `src/lib/order-balance-service.test.ts`: repair, no-op, logging/audit, and idempotence tests.
- Modify `src/lib/audit-catalog.ts`: add `ORDER_BALANCE_CACHE_REPAIR` action.
- Modify `src/lib/matching.ts`: delegate `calculateOrderBalance()` and `updateOrderBalance()` to the new service while keeping existing public names for callers.
- Modify `src/lib/matching.test.ts`: keep existing behavior and add regression coverage for status filtering through the new delegate.
- Modify `src/lib/dashboard-summary-service.ts`: include receipts in one query, compute balances once, reuse computed balances, and schedule automatic cache repair for visible mismatches.
- Modify `src/lib/dashboard-summary-service.test.ts`: wrong stored cache still returns computed Dashboard values; SUPER-DT2 equivalent; visible-only repair call; mismatch logging path.
- Modify `src/lib/invoice-read-service.ts`: remove local balance formula and use the shared pure kernel for read-side live balances.
- Modify `src/lib/deletion-service.ts` and `src/lib/order-alias-db.ts`: remove duplicate manual formulas and delegate to the unified update helper.
- Modify `src/lib/detail-export-image.ts`: use shared live-balance logic when computing payment type if receipts are available, or document remaining cache boundary if not available in that query.
- Modify write-path tests where mocks import `updateOrderBalance`: ensure normal receipt, signed receipt finalize, edit/rebind, deletion, detail receipt creation, invoice add/edit/merge, and balance transfer still call the unified helper.
- Modify `ENGINEERING_LOG.md` and concise user-facing docs if needed; do not bloat `README.md`.
- Bump version from `1.0.190` to `1.0.191` only if this implementation batch is completed and verified.

---

### Task 1: Pure Order Balance Kernel

**Files:**
- Create: `src/lib/order-balance.ts`
- Create: `src/lib/order-balance.test.ts`

**Interfaces:**
- Produces: `isReceiptIncludedInOrderBalance(status)`, `computeOrderBalanceFromReceipts(input)`, `compareStoredOrderBalance(input)`, and `normalizeOrderBalanceNumber(value)`.
- Consumes: existing money helpers from `src/lib/money.ts` and `ReceiptStatus` enum.

- [x] **Step 1: Write failing tests for formula and statuses**

Create tests proving:

```ts
expect(computeOrderBalanceFromReceipts({
  amount: 28674,
  receipts: [
    { usd: 10000, status: ReceiptStatus.RECEIVED },
    { usd: 15000, status: ReceiptStatus.SR_Received },
  ],
})).toBe(3674);
```

Also test that `SIGNING_PENDING` is ignored, and `SR_Received`, `Waiting_SWIFT`, `Bank_Transfer`, and `RECEIVED` are included.

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
npx jest src/lib/order-balance.test.ts --runInBand
```

Expected: FAIL because the file does not exist.

- [x] **Step 3: Implement the pure module**

Implementation rules:

- Use `addMoney`, `subtractMoney`, and `moneyToNumber`.
- Treat unknown/invalid amounts as `0` only at the normalization boundary.
- Compare stored/computed at cent precision.
- Return mismatch metadata with `stored`, `computed`, and `difference`.

- [x] **Step 4: Run tests and commit**

Run:

```bash
npx jest src/lib/order-balance.test.ts --runInBand
```

Expected: PASS.

Commit:

```bash
git add src/lib/order-balance.ts src/lib/order-balance.test.ts
git commit -m "feat: add order balance kernel"
```

---

### Task 2: Balance Persistence Service

**Files:**
- Create: `src/lib/order-balance-service.ts`
- Create: `src/lib/order-balance-service.test.ts`
- Modify: `src/lib/audit-catalog.ts`
- Modify: `src/lib/matching.ts`
- Modify: `src/lib/matching.test.ts`

**Interfaces:**
- Produces: `calculateLiveOrderBalance(orderId, client)`, `updateOrderBalance(orderId, client, options?)`, `repairOrderBalanceCacheIfNeeded(orderContext, client, options?)`.
- Keeps existing `matching.calculateOrderBalance()` and `matching.updateOrderBalance()` exports as compatibility wrappers.

- [x] **Step 1: Write failing service tests**

Test cases:

- `calculateLiveOrderBalance()` queries order amount and non-pending receipts and returns computed balance.
- `updateOrderBalance()` writes computed value.
- `repairOrderBalanceCacheIfNeeded()` updates only on mismatch.
- second repair call after cache is already correct performs no update.
- mismatch repair records `ORDER_BALANCE_CACHE_REPAIR` audit metadata and `logger.warn` structured detail.

- [x] **Step 2: Run service tests and verify RED**

Run:

```bash
npx jest src/lib/order-balance-service.test.ts --runInBand
```

Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement service and wrapper refactor**

Implementation rules:

- Use existing `recordAuditEvent()` and `logger.warn()`.
- If no `actorId` is available, use a system actor string such as `system:order-balance` only in audit metadata or skip audit if the existing schema requires a real user ID; do not crash Dashboard for audit failure.
- Keep the existing function signatures in `matching.ts` working for old callers.
- Do not add a POST repair API.

- [x] **Step 4: Run focused tests and commit**

Run:

```bash
npx jest src/lib/order-balance-service.test.ts src/lib/matching.test.ts --runInBand
```

Expected: PASS.

Commit:

```bash
git add src/lib/order-balance-service.ts src/lib/order-balance-service.test.ts src/lib/audit-catalog.ts src/lib/matching.ts src/lib/matching.test.ts
git commit -m "feat: centralize order balance persistence"
```

---

### Task 3: Dashboard Uses Computed Balance And Auto-Repairs Cache

**Files:**
- Modify: `src/lib/dashboard-summary-service.ts`
- Modify: `src/lib/dashboard-summary-service.test.ts`

**Interfaces:**
- Consumes: Task 1 pure balance helpers and Task 2 repair helper.
- Produces: Dashboard summary values based on computed balances only.

- [x] **Step 1: Write failing Dashboard tests**

Add tests proving:

- stored `orderBalance` can be wrong but `unpaidTotal` returns computed balance.
- SUPER-DT2 equivalent `amount 28674`, receipts `10000 + 15000`, stored `38674`, returns `3674` in customer row and released invoice row.
- `SIGNING_PENDING` receipt does not deduct.
- same computed value is used for Dashboard total, customer subtotal, and order row.
- visible order mismatches call automatic repair helper; invisible orders are not touched because they are not returned by the visibility-filtered invoice query.

- [x] **Step 2: Run Dashboard tests and verify RED**

Run:

```bash
npx jest src/lib/dashboard-summary-service.test.ts --runInBand
```

Expected: FAIL because Dashboard still trusts stored `orderBalance` and does not select receipts.

- [x] **Step 3: Refactor Dashboard summary**

Implementation rules:

- Extend order select to include linked receipts `{ usd, status }`.
- Compute each order balance once and store it in a local map/context.
- Use that computed balance for `unpaidTotal`, `releasedInvoices`, `customerOutstanding.totalOutstanding`, `statusSubtotals`, and `orders[].outstanding`.
- If stored/computed mismatch, call the repair helper for that order. Do not block the summary response on audit/log failures.
- Keep existing sort/order behavior unless it depended on stale balances.

- [x] **Step 4: Run Dashboard tests and commit**

Run:

```bash
npx jest src/lib/dashboard-summary-service.test.ts --runInBand
```

Expected: PASS.

Commit:

```bash
git add src/lib/dashboard-summary-service.ts src/lib/dashboard-summary-service.test.ts
git commit -m "fix: compute dashboard balances from receipts"
```

---

### Task 4: Remove Duplicate Balance Formulas From Read/Write Helpers

**Files:**
- Modify: `src/lib/invoice-read-service.ts`
- Modify: `src/lib/deletion-service.ts`
- Modify: `src/lib/order-alias-db.ts`
- Modify: relevant tests for those files

**Interfaces:**
- Consumes: Task 1 pure kernel and Task 2 persistence helper.

- [x] **Step 1: Add or update failing tests around duplicate formula call sites**

Target existing tests where practical:

- invoice list read returns live balance with pending receipt ignored.
- deletion/order alias recalculation delegates to the unified update helper.

- [x] **Step 2: Run focused tests and verify RED where behavior currently differs or implementation still duplicates formula**

Run relevant Jest tests:

```bash
npx jest src/lib/invoice-read-service.test.ts src/lib/deletion-service.test.ts --runInBand
```

- [x] **Step 3: Refactor duplicate formula call sites**

Implementation rules:

- Replace local `computeLiveOrderBalance()` in invoice read service with the shared pure function.
- Replace manual receipt-sum update in deletion/order alias helper with `updateOrderBalance()` using the current transaction/client where available.
- Do not widen visibility beyond the caller's existing query.

- [x] **Step 4: Run tests and commit**

Run:

```bash
npx jest src/lib/invoice-read-service.test.ts src/lib/deletion-service.test.ts src/lib/order-alias-db.test.ts --runInBand
```

If `order-alias-db.test.ts` does not exist, run the nearest existing alias tests and document the gap.

Commit:

```bash
git add src/lib/invoice-read-service.ts src/lib/deletion-service.ts src/lib/order-alias-db.ts src/lib/*test.ts
git commit -m "refactor: reuse order balance calculation"
```

---

### Task 5: Audit Major Balance Write Paths

**Files:**
- Modify tests only where current coverage proves calls through the wrapper: receipt, receipt generator, receipt edit request, detail, invoice.
- Modify implementation files only if a path still bypasses the unified helper.

**Interfaces:**
- Consumes: compatibility wrapper `updateOrderBalance()`.

- [x] **Step 1: Verify write-path tests cover the wrapper call**

Check and update tests for:

- `src/lib/receipt-service.test.ts`
- `src/lib/receipt-generator-service.test.ts`
- `src/lib/receipt-edit-request-service.test.ts`
- `src/lib/detail-service.test.ts`
- `src/lib/invoice-service.test.ts`
- `src/lib/invoice-write.test.ts`

- [x] **Step 2: Move unsafe post-commit balance updates into transactions when low-risk**

For each modified path, prefer passing the current transaction client to `updateOrderBalance(orderId, tx)`.

If a path cannot be safely moved in this batch, leave behavior intact but make it call the unified helper and document the remaining post-commit boundary in `ENGINEERING_LOG.md`.

- [x] **Step 3: Run focused service tests**

Run:

```bash
npx jest src/lib/receipt-service.test.ts src/lib/receipt-generator-service.test.ts src/lib/receipt-edit-request-service.test.ts src/lib/detail-service.test.ts src/lib/invoice-service.test.ts src/lib/invoice-write.test.ts --runInBand
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/lib src/app/api ENGINEERING_LOG.md
git commit -m "test: guard order balance write paths"
```

---

### Task 6: Documentation, Version, And Full Verification

**Files:**
- Modify: `ENGINEERING_LOG.md`
- Modify: `README.md` only if a concise user-facing behavior note is necessary.
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Update engineering notes**

Record:

- Dashboard balances now use backend computed live balance.
- `Order.orderBalance` is a cache only.
- cache mismatch auto-repair logs/audits silently.
- no backup scope change because no schema or media path changed.
- remaining balance write-path boundaries if any were intentionally not moved into transactions.

- [x] **Step 2: Bump version to `1.0.191`**

Use npm version tooling or edit both package files consistently.

- [x] **Step 3: Run focused and full verification**

Run:

```bash
npx jest src/lib/order-balance.test.ts src/lib/order-balance-service.test.ts src/lib/dashboard-summary-service.test.ts --runInBand
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Expected: all pass.

- [x] **Step 4: Commit**

```bash
git add README.md ENGINEERING_LOG.md package.json package-lock.json
git commit -m "chore: document dashboard balance guard"
```

---

## Execution Order With Existing Work

1. Complete this Dashboard live balance plan first.
2. Then execute `docs/superpowers/plans/2026-07-03-customer-order-history-pagination-sorting.md`.
3. After both batches pass tests, run the project safe rebuild script only if deployment is requested:
   `scripts/rebuild-local-app.sh`.
4. If that script fails, report full output, exit stage, exit code, docker logs, and data-risk assessment.
