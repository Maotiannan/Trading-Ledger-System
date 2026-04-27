# Invoice Rematch Single Customer Reparse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow invoice rematch to retry customer resolution for orders that are still unresolved (`customerId = null` and `needsCustomerFix = true`).

**Architecture:** Keep existing rematch behavior intact, then add a narrow post-pass over unresolved visible orders. Re-run `resolveCustomer(...)` only for those rows and update only the row that now resolves uniquely.

**Tech Stack:** Next.js, Prisma, Jest, isolated API cases

---

### Task 1: Lock failing coverage

**Files:**
- Modify: `src/lib/invoice-service.test.ts`
- Modify: `tests/api/isolated/cases/20-invoice-ledger-flow.case.mjs`

- [ ] Add a unit test proving `rematchInvoices()` resolves a single unresolved order when the customer now exists.
- [ ] Add an isolated API step covering: create unresolved invoice order -> create matching customer later -> call rematch -> verify order clears `needsCustomerFix` and gets `customerId`.

### Task 2: Implement narrow rematch reparse

**Files:**
- Modify: `src/lib/invoice-service.ts`

- [ ] Add a post-pass in `rematchAllOrders()` that queries only visible orders with `customerId = null` and `needsCustomerFix = true`.
- [ ] Re-run `resolveCustomer()` using existing row data.
- [ ] Update only orders that now resolve uniquely.
- [ ] Increase `customerSyncedCount` only for successfully repaired orders.

### Task 3: Verify and sync docs/version

**Files:**
- Modify: `README.md`
- Modify: `todolist.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `package.json`

- [ ] Run targeted Jest + isolated API + build.
- [ ] Update docs and version.
- [ ] Rebuild local docker service.
