# Global Pagination And Guinea Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Payment Detail/SWIFT pagination and standardize app-created time formatting on Guinea time.

**Architecture:** Add a small shared `ListPagination` component and a small `app-time` formatting utility. Replace duplicated list footer markup in Detail/SWIFT lists and update the receipt generator date formatter to consume the global timezone.

**Tech Stack:** Next.js, React, Jest, Testing Library, TypeScript.

## Global Constraints

- Database timestamps remain UTC/Date values; only display and generated document formatting use Guinea time.
- Pagination visible text must be compact: arrows and `1 / 2 (15)`.
- Existing accessible labels remain available for screen readers and tests.
- Do not touch Docker, database volumes, NAS, or migrations for this UI/time-formatting change.

---

### Task 1: Shared Pagination Component

**Files:**
- Create: `src/components/workspace/modules/shared/list-pagination.tsx`
- Create: `src/components/workspace/modules/shared/list-pagination.test.tsx`

**Interfaces:**
- Produces: `ListPagination(props)` with page-size select, arrow buttons, and compact summary.

- [ ] Write failing tests for compact summary, hidden rows-per-page label, arrow buttons, and page-size change.
- [ ] Implement `ListPagination` using existing `Button` and native `select` styles.
- [ ] Run the component test and confirm it passes.

### Task 2: Detail And SWIFT Pagination Integration

**Files:**
- Modify: `src/components/workspace/modules/details/components/detail-list.tsx`
- Modify: `src/components/workspace/modules/details/components/detail-list.test.tsx`
- Modify: `src/components/workspace/modules/swifts/components/swift-list.tsx`
- Modify: `src/components/workspace/modules/swifts/components/swift-list.test.tsx`

**Interfaces:**
- Consumes: `ListPagination` from Task 1.

- [ ] Update list tests to assert `1 / 1 (1)`, `←`, `→`, and no visible rows-per-page wording.
- [ ] Replace duplicated footer markup in both list components.
- [ ] Run detail and swift list tests.

### Task 3: Global App Time Utility

**Files:**
- Create: `src/lib/app-time.ts`
- Create: `src/lib/app-time.test.ts`
- Modify: `src/lib/receipt-generator-layout.ts`
- Modify: `src/lib/receipt-generator-layout.test.ts`

**Interfaces:**
- Produces: `APP_TIME_ZONE`, `formatAppDate`, `formatAppDateTime`, `formatAppDateInputValue`.
- Consumes: `formatAppDate` in receipt generation.

- [ ] Write failing tests that prove Conakry date formatting is independent from browser/local timezone and that the receipt generator no longer uses Shanghai date rollover.
- [ ] Implement the app-time utility and replace the receipt generator formatter.
- [ ] Run app-time and receipt generator layout tests.

### Task 4: Verification And Git

**Files:**
- Modify docs if implementation details differ from this plan.

- [ ] Run targeted Jest tests for pagination and time.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build` with validation DATABASE_URL if needed.
- [ ] Commit changes on the feature branch and push for CI.
