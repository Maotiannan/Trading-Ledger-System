# Invoice Branch Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invoice-to-branch-admin reassignment and fix customer-owner-based sales visibility across financial resources.

**Architecture:** Reuse the existing ownership model by moving `createdBy` on invoice and orders, and correct read/write visibility to use `customer.ownerId` as the customer binding source. Keep routes thin and put validation, transaction boundaries, and audit in services.

**Tech Stack:** Next.js, Prisma, Jest, isolated API tests.

---

### Task 1: Lock behavior with failing tests

**Files:**
- Modify: `src/lib/invoice-service.test.ts`
- Modify: `tests/api/isolated/cases/20-invoice-ledger-flow.case.mjs`

- [ ] Add service tests for invoice reassignment authorization and owner update.
- [ ] Add API flow coverage for reassignment and visibility via bound customer owner.
- [ ] Run targeted tests and confirm they fail for the right reason.

### Task 2: Fix backend visibility and add reassignment action

**Files:**
- Modify: `src/lib/resource-visibility.ts`
- Modify: `src/lib/invoice-service.ts`
- Modify: `src/app/api/invoice/route.ts`
- Modify: `src/lib/audit-catalog.ts`

- [ ] Replace customer creator visibility with customer owner visibility where customer binding should grant access.
- [ ] Add transactional invoice reassignment service action.
- [ ] Expose route action and structured success/error responses.

### Task 3: Add invoice reassignment UI

**Files:**
- Modify: `src/components/workspace/modules/invoices/components/invoice-list.tsx`
- Modify: `src/components/workspace/modules/invoices/hooks/use-invoice-tools.ts`
- Modify: `src/components/workspace/modules/invoices/invoice-manager.tsx`
- Modify: `src/lib/auth-read-service.ts` or related route if extra option query is needed.

- [ ] Load descendant ADMIN options for current ADMIN.
- [ ] Render ADMIN-only reassignment control on invoice cards.
- [ ] Submit action and refresh invoice list on success.

### Task 4: Verify and sync operational artifacts

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`

- [ ] Run targeted unit tests, isolated API tests, lint, and build.
- [ ] Bump version and update docs.
- [ ] Rebuild local docker service.
