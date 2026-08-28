# MU Contract Full Reconcile Preview Conflict Count Implementation Plan

> **Status:** `ARCHIVED_COMPLETED`; PR #28 passed CI and merged to `main` on 2026-08-28.

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline with test-driven development; subagents are prohibited unless the user explicitly requests them.

**Goal:** Stop Full Reconcile preview from reporting inactive-history replacement pairs as duplicate conflicts while preserving real active-source collision detection.

**Architecture:** Keep the change inside the existing preview analysis service. Build duplicate counts from active snapshot rows, then reuse the existing normalized ORDER NO lookup during per-row classification.

**Tech Stack:** TypeScript, Next.js, Prisma, Jest.

## Global Constraints

- Do not change apply behavior or persisted synchronization data.
- Do not touch financial orders, invoices, receipts, payment details, SWIFT, balances, media, migrations, or Docker volumes.
- Follow red-green-refactor and verify the production build before release.

---

### Task 1: Reproduce The False Conflict

**Files:**
- Modify: `src/lib/integrations/mu-contract-reconcile-service.test.ts`

- [x] Add a snapshot fixture containing an inactive historical PI and an active replacement PI with the same ORDER NO.
- [x] Assert the preview reports `inactive: 1` and `conflicts: 0`.
- [x] Run the targeted Jest test and confirm it fails with `conflicts: 2`.

### Task 2: Correct Duplicate Classification

**Files:**
- Modify: `src/lib/integrations/mu-contract-reconcile-service.ts`
- Modify: `src/lib/integrations/mu-contract-reconcile-service.test.ts`

- [x] Count duplicate ORDER NO values from active source rows only.
- [x] Add a two-active-PI regression test that still expects two conflicts.
- [x] Run the targeted suite and confirm both cases pass.

### Task 3: Release And Verify

**Files:**
- Modify: `docs/data-and-integrations.md`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `todolist.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Document the preview conflict definition and no-data-impact boundary.
- [x] Increment the single-source application version once.
- [x] Run targeted tests, type checking, linting, i18n audit, and production build.
- [x] Commit, push, open a PR, and watch CI through completion.
- [x] Do not rebuild the existing Docker service until the user explicitly requests it.
