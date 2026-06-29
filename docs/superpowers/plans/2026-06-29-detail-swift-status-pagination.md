# Detail Swift Status Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Payment Detail Management and SWIFT Management default to active records, support multi-status filters including ALL, and persist page size per account.

**Architecture:** Reuse the existing user-preferences API and add one JSON preference for list page sizes. Keep filtering server-backed, with repeated `status` query parameters and local pagination over returned rows, matching the Receipt Management pattern.

**Tech Stack:** Next.js App Router, React, Prisma/MySQL, Jest, TypeScript.

## Global Constraints

- Default Payment Detail statuses: `Waiting_SWIFT`, `Bank_Transfer`, `ERROR`; `RECEIVED` is hidden unless selected or ALL is selected.
- Default SWIFT statuses: `Bank_Transfer`, `ERROR`; `RECEIVED` is hidden unless selected or ALL is selected.
- Page size options: `5 / 10 / 20 / 50`; default is `10`.
- Page size preference is per account through `UserPreference`, not browser-only local state.
- No business data mutation.

---

### Task 1: User Preference Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260629120000_user_list_page_size_preference/migration.sql`
- Modify: `src/lib/user-preference-service.ts`
- Modify: `src/lib/user-preference-service.test.ts`
- Modify: `src/lib/settings-service.test.ts`

**Deliverable:** API returns and updates `listPageSizes.detail` and `listPageSizes.swift`.

### Task 2: Status Filters And Pagination UI

**Files:**
- Create: `src/components/workspace/modules/shared/status-multi-select-filter.tsx`
- Modify: `src/components/workspace/modules/details/detail-manager.tsx`
- Modify: `src/components/workspace/modules/swifts/swift-manager.tsx`
- Modify: `src/components/workspace/modules/details/components/detail-list.tsx`
- Modify: `src/components/workspace/modules/swifts/components/swift-list.tsx`
- Modify matching Jest tests.

**Deliverable:** Detail/SWIFT pages use multi-select status filters and paginated lists.

### Task 3: API Status Filtering

**Files:**
- Modify: `src/app/api/detail/route.ts`
- Modify: `src/app/api/swift/route.ts`

**Deliverable:** repeated status query parameters are applied server-side; SWIFT `ERROR` maps to `hasError=true`.

### Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/backup/muledger-cos-backup.md`

**Verification:** run targeted Jest tests and typecheck if practical.
