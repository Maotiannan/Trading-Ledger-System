# Dashboard History Order and Pending Signed Receipt Draft Edit Implementation Plan

> **Status:** `ARCHIVED_COMPLETED` on 2026-08-26. The original checklist is preserved as execution history; actual verification evidence is recorded in `ENGINEERING_LOG.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Dashboard Recent Receipts before Historical Orders and make unfinished generated signed-receipt drafts safely editable and resumable.

**Architecture:** Keep the shared customer-history component reusable through a Dashboard-only section-order option. Add one transaction-aware pending generator-draft synchronizer consumed by both ADMIN direct edits and SALES approval edits so Receipt and signing-session state cannot diverge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 6/MySQL, Jest and Testing Library, existing transaction, matching, order-balance, receipt-generator, audit, and visibility services.

## Global Constraints

- Do not use subagents; the user did not request them.
- Do not touch the running Docker service or live business data during implementation.
- Preserve the existing role model: ADMIN direct edit, SALES approval edit.
- Preserve generator-only fields that are not editable in Receipt Management.
- Use `calculateLiveOrderBalance` and `buildReceiptGeneratorLayout`; do not add another balance or receipt-layout formula.
- Pending Receipt and ReceiptGeneratorSession changes must be in the same transaction.
- No database migration, media-path change, or backup-scope change is required.
- Before push, PR, merge, and deployment, synchronize latest `main` and run fresh verification.

---

### Task 1: Dashboard-specific history section order

**Files:**
- Modify: `src/components/workspace/modules/customers/components/customer-order-history-content.tsx`
- Modify: `src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.tsx`
- Test: `src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx`
- Test: `src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx`

**Interfaces:**
- Produces: optional `sectionOrder?: 'orders-first' | 'receipts-first'` on `CustomerOrderHistoryContentProps`.
- Default: `orders-first` so Customer Management remains unchanged.
- Dashboard passes: `sectionOrder="receipts-first"`.

- [ ] **Step 1: Add failing DOM-order tests**

Assert that the Dashboard receipts heading precedes the orders heading, while Customer Management retains the opposite order:

```ts
const recent = within(dialog).getByText('Recent Receipts');
const historical = within(dialog).getByText('Historical Orders');
expect(recent.compareDocumentPosition(historical) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

- [ ] **Step 2: Verify the Dashboard test fails for the current order**

Run:

```bash
npm test -- --runInBand \
  src/components/workspace/modules/dashboard/components/dashboard-customer-detail-dialog.test.tsx \
  src/components/workspace/modules/customers/components/customer-order-history-dialog.test.tsx
```

Expected: Dashboard order assertion fails; Customer Management assertion passes.

- [ ] **Step 3: Implement the minimal reusable order option**

Build the two existing sections once, then render them according to `sectionOrder`; do not duplicate either table or pagination block. Pass `receipts-first` only from `DashboardCustomerDetailDialog`.

- [ ] **Step 4: Re-run both component tests**

Expected: both suites pass and preserve all existing layout assertions.

### Task 2: Transactional pending generator-draft synchronization

**Files:**
- Create: `src/lib/receipt-generator-draft-service.ts`
- Create: `src/lib/receipt-generator-draft-service.test.ts`
- Modify: `src/lib/receipt-generator-layout.ts`
- Modify: `src/lib/receipt-generator-read-service.ts`
- Modify: `src/lib/receipt-service.ts`
- Modify: `src/lib/receipt-edit-request-service.ts`
- Test: `src/lib/receipt-service.test.ts`
- Test: `src/lib/receipt-edit-request-service.test.ts`
- Test: `src/lib/receipt-generator-read-service.test.ts`

**Interfaces:**
- Produces: `syncPendingReceiptGeneratorDraft(tx, input): Promise<void>`.
- Input includes the updated editable Receipt values, resolved order binding, matched customer snapshot, and receipt status.
- Consumes: `calculateLiveOrderBalance`, `buildReceiptGeneratorLayout`, and existing generator normalizers.

- [ ] **Step 1: Write failing service tests**

Cover preservation and rebuilding:

```ts
await syncPendingReceiptGeneratorDraft(tx, {
  receiptId: 'receipt-1',
  status: ReceiptStatus.SIGNING_PENDING,
  receiptNo: '0010010',
  date: new Date('2026-08-26T00:00:00.000Z'),
  orderId: 'order-2',
  orderNo: 'PIKIN-20',
  invNo: 'INV-2',
  customerId: 'customer-2',
  customerMark: 'PIKIN',
  customerName: 'Mamadou Dian Diallo',
  payer: 'Mamadou Dian Diallo "PIKIN"',
  tel: '+224 620 00 00 00',
});
expect(tx.receiptGeneratorSession.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    receiptNo: '0010010',
    orderNo: 'PIKIN-20',
    invNo: 'INV-2',
    layoutSnapshot: expect.objectContaining({
      clientName: 'Mamadou Dian Diallo "PIKIN"',
      paymentType: 'Final',
    }),
  }),
}));
```

Also assert a missing pending session rejects and no update occurs. A non-`SIGNING_PENDING` receipt returns without querying a generator session.

- [ ] **Step 2: Run the new service test and verify RED**

Run:

```bash
npm test -- --runInBand src/lib/receipt-generator-draft-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the draft synchronizer**

Load the pending session by `receiptId` and `PENDING` status. Preserve `usd`, payment type, payment mode, fee status, received-by, and existing company-name metadata. Recalculate balance for the resolved order through `calculateLiveOrderBalance(orderId, tx)`. Rebuild the complete snapshot using the edited fields and update the session denormalized columns and snapshot in one call.

- [ ] **Step 4: Make resume reads honor synchronized date and payer**

Allow `buildReceiptGeneratorLayout` to accept a validated payer display override. Include Receipt date in session reads, use it as the generated date, and pass the synchronized snapshot payer override. Keep normal creation behavior unchanged when no override is provided.

- [ ] **Step 5: Add failing direct ADMIN edit regression tests**

Replace the old expectation that `SIGNING_PENDING` direct edits reject with assertions that the receipt update and `syncPendingReceiptGeneratorDraft` run within the existing transaction. Add a missing-session error propagation assertion.

- [ ] **Step 6: Invoke synchronization from direct ADMIN edits**

After the Receipt and Detail Item updates, call the synchronizer with the final binding and customer values before returning from the transaction. Remove only the unconditional pending-edit rejection; retain the `Bank_Transfer` restriction and all visibility checks.

- [ ] **Step 7: Add failing SALES approval regression tests**

Assert request creation remains unchanged and approval of a pending draft calls the same synchronizer with the approved snapshot. Rejection must not modify Receipt or generator session.

- [ ] **Step 8: Invoke synchronization from approved SALES edits**

Call the same synchronizer after the approved Receipt update and Detail Item synchronization, inside the approval transaction.

- [ ] **Step 9: Run all targeted tests**

Run:

```bash
npm test -- --runInBand \
  src/lib/receipt-generator-draft-service.test.ts \
  src/lib/receipt-service.test.ts \
  src/lib/receipt-edit-request-service.test.ts \
  src/lib/receipt-generator-read-service.test.ts \
  src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx \
  src/components/workspace/modules/receipts/receipt-manager.test.tsx
```

Expected: all pass.

### Task 3: Release verification and delivery

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `docs/superpowers/plans/README.md`
- Modify: `docs/superpowers/plans/2026-08-26-dashboard-history-signing-draft-edit.md`

- [ ] **Step 1: Run full verification**

Run fresh typecheck, lint, full Jest, isolated API tests, isolated E2E tests, and production build. No existing live Docker service or live database may be reused by isolated test scripts.

- [ ] **Step 2: Review the full diff against the approved design**

Confirm Dashboard-only ordering, transactional session synchronization, role behavior, missing-session rollback, generator-only field preservation, no migration, and no upload-path change.

- [ ] **Step 3: Update release metadata**

Bump the single package version from `1.0.211` to `1.0.212`, update the concise README recent-update line, append verified engineering evidence, mark this plan `ARCHIVED_COMPLETED`, and update the plan index.

- [ ] **Step 4: Synchronize latest main and re-verify**

Fetch `origin/main`, reconcile any new commits without overwriting other agents, and rerun impacted tests after reconciliation.

- [ ] **Step 5: Commit, push, open PR, and wait for CI**

Push the feature branch through Clash if needed, create a PR with requirements and test evidence, and do not merge until every required GitHub Actions check passes.

- [ ] **Step 6: Merge and safely deploy**

Merge the approved PR, update local `main`, run `scripts/rebuild-local-app.sh`, then verify containers, startup logs, version `1.0.212`, authenticated health semantics, public HTTP response, MySQL connection, and NAS upload mount. If rebuilding fails, report the full required diagnostics and data-risk assessment.
