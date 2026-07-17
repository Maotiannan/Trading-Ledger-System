# Orders Confirmed Date Implementation Plan

> **Plan status:** `ARCHIVED_COMPLETED` as of 2026-07-17. The implementation is on `main`; unchecked boxes below are retained as the original execution checklist and are not active backlog. See [the status index](./README.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display the Guinea date on which an Orders-page record most recently entered `Confirmed` status.

**Architecture:** Add a pure transition kernel for confirmation timestamp semantics, persist its result in nullable `OrderTracker.confirmedAt`, and keep status plus timestamp in one Prisma write. Extend the existing Orders list row and table without adding a new endpoint or a client-editable date.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma 6/MySQL, Jest, React Testing Library, isolated MariaDB API tests, Docker Compose.

## Global Constraints

- Place `CONFIRMED DATE` immediately after `DEPOSIT` and before `Customer`.
- Format it as `DD/MM/YYYY` in `Africa/Conakry` through `formatAppDate`.
- Entering `Confirmed` records current server time; leaving clears it; no-op or unrelated edits preserve it.
- Backfill existing current `Confirmed` rows once from `updatedAt`; keep all other historical rows null.
- The server owns the timestamp; existing Orders permissions remain unchanged.
- Status and timestamp update atomically in one Prisma update.
- Existing MySQL backup covers the field; no NAS/COS media path changes.
- Version becomes `1.0.194`.

## File Structure

- Create `src/lib/order-tracker-confirmation.ts` and its test: pure timestamp rules.
- Modify `prisma/schema.prisma`; create migration `20260714110000_order_tracker_confirmed_at`.
- Modify `src/lib/order-tracker-service.ts` and its test: create/update/list and audit integration.
- Modify Orders row type, table component, and component test.
- Extend isolated API case `25-order-tracker`.
- Update backup/API/release documentation and package version.

---

### Task 1: Pure Confirmation Transition Kernel

**Files:**
- Create: `src/lib/order-tracker-confirmation.test.ts`
- Create: `src/lib/order-tracker-confirmation.ts`

**Interfaces:**
- `confirmedAtForNewOrder(status: string, now?: Date): Date | null`
- `confirmedAtForStatusUpdate(input): Date | null | undefined`, where `undefined` means preserve stored data.

- [x] **Step 1: Write failing deterministic tests**

```ts
import { confirmedAtForNewOrder, confirmedAtForStatusUpdate } from './order-tracker-confirmation';

const now = new Date('2026-07-14T10:00:00.000Z');
const previous = new Date('2026-07-01T08:00:00.000Z');

expect(confirmedAtForNewOrder('Confirmed', now)).toBe(now);
expect(confirmedAtForNewOrder('In progress', now)).toBeNull();
expect(confirmedAtForStatusUpdate({ currentStatus: 'In progress', nextStatus: 'Confirmed', now })).toBe(now);
expect(confirmedAtForStatusUpdate({ currentStatus: 'Confirmed', nextStatus: 'Canceled', now })).toBeNull();
expect(confirmedAtForStatusUpdate({ currentStatus: 'Confirmed', nextStatus: 'Confirmed', now })).toBeUndefined();
expect(confirmedAtForStatusUpdate({ currentStatus: 'In progress', nextStatus: 'Canceled', now })).toBeUndefined();
expect(confirmedAtForStatusUpdate({ currentStatus: 'Canceled', nextStatus: 'Confirmed', now })).toBe(now);
```

- [x] **Step 2: Verify RED**

Run `npx jest src/lib/order-tracker-confirmation.test.ts --runInBand`.

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the minimal kernel**

```ts
export const ORDER_TRACKER_CONFIRMED_STATUS = 'Confirmed';

export function confirmedAtForNewOrder(status: string, now = new Date()): Date | null {
  return status === ORDER_TRACKER_CONFIRMED_STATUS ? now : null;
}

export function confirmedAtForStatusUpdate(input: {
  currentStatus: string;
  nextStatus: string;
  now?: Date;
}): Date | null | undefined {
  if (input.currentStatus === input.nextStatus) return undefined;
  if (input.nextStatus === ORDER_TRACKER_CONFIRMED_STATUS) return input.now || new Date();
  if (input.currentStatus === ORDER_TRACKER_CONFIRMED_STATUS) return null;
  return undefined;
}
```

- [x] **Step 4: Verify GREEN**

Run the same Jest command and require all tests to pass.

---

### Task 2: Migration And Atomic Service Writes

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260714110000_order_tracker_confirmed_at/migration.sql`
- Modify: `src/lib/order-tracker-service.test.ts`
- Modify: `src/lib/order-tracker-service.ts`

**Interfaces:**
- `OrderTracker.confirmedAt: DateTime?`
- Existing create/update APIs compute the field server-side.

- [x] **Step 1: Add failing service tests**

Assert create with `Confirmed` writes `confirmedAt: expect.any(Date)`, default creation writes null, entering writes a Date, leaving writes null, same-status and remark-only updates omit the field, and actual transitions add `statusBefore/statusAfter/confirmedAtBefore/confirmedAtAfter` audit metadata.

- [x] **Step 2: Verify RED**

Run `npx jest src/lib/order-tracker-service.test.ts --runInBand` and require failure on missing timestamp behavior.

- [x] **Step 3: Add schema and migration**

```prisma
confirmedAt DateTime?
```

```sql
ALTER TABLE `OrderTracker`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL;

UPDATE `OrderTracker`
SET `confirmedAt` = `updatedAt`
WHERE `status` = 'Confirmed'
  AND `confirmedAt` IS NULL;
```

- [x] **Step 4: Implement service behavior**

On create, set `confirmedAt: confirmedAtForNewOrder(status)`. On update, sanitize the requested status, call the pure transition helper, and add `data.confirmedAt` only when its result is not `undefined`. Build audit before/after values from the target row and computed update; do not accept `confirmedAt` from the request body.

- [x] **Step 5: Generate Prisma and verify GREEN**

```bash
npx prisma generate
npx jest src/lib/order-tracker-confirmation.test.ts src/lib/order-tracker-service.test.ts --runInBand
```

Expected: both suites PASS.

---

### Task 3: Orders Table Column

**Files:**
- Modify: `src/components/workspace/modules/orders/types.ts`
- Modify: `src/components/workspace/modules/orders/order-tracker-manager.test.tsx`
- Modify: `src/components/workspace/modules/orders/order-tracker-manager.tsx`

**Interfaces:**
- `OrderTrackerRow.confirmedAt: string | null`
- UI renders `formatAppDate(row.confirmedAt)`.

- [x] **Step 1: Write failing UI tests**

Use one row with `confirmedAt: '2026-07-13T23:30:00.000Z'` and one null row. Assert header order `DEPOSIT`, `CONFIRMED DATE`, `Customer`, displayed `13/07/2026`, and `-` for null.

- [x] **Step 2: Verify RED**

Run `npx jest src/components/workspace/modules/orders/order-tracker-manager.test.tsx --runInBand` and require failure because the column is absent.

- [x] **Step 3: Implement UI**

Import `formatAppDate`, add the row type field, render header/cell immediately after DEPOSIT with `whitespace-nowrap`, and increase empty row `colSpan` from `8` to `9`.

- [x] **Step 4: Verify GREEN**

Run the same component suite and require all tests to pass.

---

### Task 4: Isolated API, Documentation, Backup Coverage, And Version

**Files:**
- Modify: `tests/api/isolated/cases/25-order-tracker.case.mjs`
- Modify: `docs/backup/muledger-cos-backup.md`
- Modify: `docs/API_TESTING.md`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Extend the isolated API lifecycle**

Assert initial null; Confirmed produces a parseable timestamp; remark-only update preserves the exact value; Canceled clears it; returning to Confirmed produces a later value.

- [x] **Step 2: Update durable-data and API documentation**

Record that `OrderTracker.confirmedAt` is inside the existing `trading_ledger` dump, no media path changes, and historical Confirmed rows use one-time `updatedAt` backfill. Document server-owned transition behavior and release notes.

- [x] **Step 3: Bump version**

Run `npm version 1.0.194 --no-git-tag-version`.

- [x] **Step 4: Verify isolated API and migration**

Run `bash scripts/test-api-isolated.sh --case 25-order-tracker`.

Expected: migration deploys to temporary MariaDB and all lifecycle assertions PASS.

---

### Task 5: Final Gates, Git, CI, Backup, And Safe Deployment

- [x] **Step 1: Run local final gates sequentially**

```bash
git diff --check
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
```

- [x] **Step 2: Review persistence diff**

Confirm the only migration adds/backfills `confirmedAt`, Docker/NAS paths are unchanged, and the backup runbook covers the field.

- [ ] **Step 3: Commit and push**

Commit with `feat: track orders confirmed date`, push `main`, and confirm HEAD equals `origin/main`.

- [ ] **Step 4: Watch CI through completion**

Use `gh run list` and `gh run watch --exit-status`; do not deploy while CI is pending or failed.

- [ ] **Step 5: Create fresh pre-migration database backup**

```bash
bash scripts/backup/muledger-cos-backup.sh --dry-run --skip-media
bash scripts/backup/muledger-cos-backup.sh --check-cos --skip-media
```

Expected: verified compressed dump, checksum, and manifest uploaded before migration.

- [ ] **Step 6: Run safe rebuild with full log capture**

Run `scripts/rebuild-local-app.sh` through `bash -o pipefail` and `tee`. Its container entrypoint applies the one pending migration. On failure, report exact phase, exit code, logs, and data risk.

- [ ] **Step 7: Verify deployment**

Confirm version `1.0.194`, zero container restarts, no pending migrations, unchanged NAS mount, health and maintenance checks, authenticated Orders API behavior, clean app logs, clean Git status, and successful CI.
