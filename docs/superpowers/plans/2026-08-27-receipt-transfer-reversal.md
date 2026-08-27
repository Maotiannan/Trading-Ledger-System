# Receipt Transfer Reversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate payments when an original Receipt is rebound after a balance transfer, provide an ADMIN-only transactional reversal, repair `TRANSFER-1787794481934`, and localize Receipt edit results.

**Architecture:** Add an explicit one-to-one link from each `BalanceTransfer` to its generated Receipt. A single transaction-aware reversal service owns transfer validation, source-amount reversal, synthetic Receipt deletion, balance recalculation, safe pool cleanup, and strict audit writing. Both direct ADMIN edits and approved SALES edits use one shared Receipt-edit executor that detects a matching transfer, requires explicit confirmation, and invokes the same reversal service before rebinding the original Receipt.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 6.19, MySQL/MariaDB 10.6, Jest, Testing Library, isolated API test harness, Docker Compose.

## Global Constraints

- Do not use subagents unless the user explicitly selects subagent-driven execution.
- Do not modify the running database or NAS files during implementation and automated testing.
- Use an isolated MySQL/Docker environment for migration, API, and repair verification.
- Generic Receipt deletion and Approval behavior must remain unchanged.
- Only ADMIN may reverse a linked system transfer; SALES and USER must be denied server-side and hidden in the UI.
- All accounting writes, live balance recalculation, pool cleanup, and required audit evidence must commit or roll back together.
- Never guess an ambiguous historical or edit-time transfer relationship.
- Before production migration and repair, create and verify a fresh full `trading_ledger` plus `UPLOAD_HOST_DIR` backup and restore it in isolation.
- Before PR creation, testing after upstream changes, and merge, synchronize the latest `main`.
- Version remains a single source in `package.json`; update `package-lock.json`, README, engineering records, Docker output, and Git together.

---

### Task 1: Establish a clean baseline and add the explicit transfer-to-Receipt relationship

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260827090000_balance_transfer_generated_receipt/migration.sql`
- Test: Prisma validation and isolated migration rehearsal in Task 9

**Interfaces:**
- Produces: `BalanceTransfer.generatedReceiptId`, `BalanceTransfer.generatedReceipt`, and `Receipt.generatedByBalanceTransfer`.
- Migration backfills only a unique historical candidate and leaves ambiguous rows null.

- [ ] **Step 1: Install dependencies and verify the branch baseline**

Run:

```bash
npm ci
npx prisma generate
npm test -- --runInBand src/lib/invoice-service.test.ts src/lib/receipt-service.test.ts src/lib/receipt-edit-request-service.test.ts src/app/api/receipt/route.test.ts src/components/workspace/modules/receipts/components/receipt-list.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx
```

Expected: dependency installation exits `0`; all selected suites pass before feature code is changed. If not, stop and report the pre-existing failure.

- [ ] **Step 2: Add the failing schema expectation**

Run this read-only check before editing:

```bash
rg -n "generatedReceiptId|generatedByBalanceTransfer" prisma/schema.prisma
```

Expected: no matches.

- [ ] **Step 3: Add the Prisma relationship**

Add to `Receipt`:

```prisma
generatedByBalanceTransfer BalanceTransfer? @relation("BalanceTransferGeneratedReceipt")
```

Add to `BalanceTransfer`:

```prisma
generatedReceiptId String?  @unique
generatedReceipt   Receipt? @relation(
  "BalanceTransferGeneratedReceipt",
  fields: [generatedReceiptId],
  references: [id],
  onDelete: Restrict
)
```

- [ ] **Step 4: Add the migration and conservative historical backfill**

The migration must:

```sql
ALTER TABLE `BalanceTransfer`
  ADD COLUMN `generatedReceiptId` VARCHAR(191) NULL;

CREATE TEMPORARY TABLE `_BalanceTransferReceiptCandidates` AS
SELECT bt.`id` AS `transferId`, receipt.`id` AS `receiptId`
FROM `BalanceTransfer` bt
JOIN `Order` source_order ON source_order.`id` = bt.`fromOrderId`
JOIN `Receipt` receipt
  ON receipt.`orderId` = bt.`toOrderId`
 AND receipt.`usd` = bt.`amount`
 AND receipt.`createdBy` = bt.`createdBy`
 AND receipt.`receiptNo` LIKE 'TRANSFER-%'
 AND receipt.`payer` = CONCAT('余额转移自 ', source_order.`orderNo`)
 AND receipt.`note` = CONCAT('从订单 ', source_order.`orderNo`, ' 转移的余额')
 AND ABS(TIMESTAMPDIFF(SECOND, receipt.`createdAt`, bt.`createdAt`)) <= 5
WHERE bt.`generatedReceiptId` IS NULL;

CREATE TEMPORARY TABLE `_BalanceTransferCandidateCounts` AS
SELECT `transferId`, COUNT(*) AS `candidateCount`
FROM `_BalanceTransferReceiptCandidates`
GROUP BY `transferId`;

CREATE TEMPORARY TABLE `_ReceiptTransferCandidateCounts` AS
SELECT `receiptId`, COUNT(*) AS `candidateCount`
FROM `_BalanceTransferReceiptCandidates`
GROUP BY `receiptId`;

UPDATE `BalanceTransfer` bt
JOIN `_BalanceTransferReceiptCandidates` candidate
  ON candidate.`transferId` = bt.`id`
JOIN `_BalanceTransferCandidateCounts` transfer_count
  ON transfer_count.`transferId` = candidate.`transferId`
 AND transfer_count.`candidateCount` = 1
JOIN `_ReceiptTransferCandidateCounts` receipt_count
  ON receipt_count.`receiptId` = candidate.`receiptId`
 AND receipt_count.`candidateCount` = 1
SET bt.`generatedReceiptId` = candidate.`receiptId`
WHERE bt.`generatedReceiptId` IS NULL;

DROP TEMPORARY TABLE `_ReceiptTransferCandidateCounts`;
DROP TEMPORARY TABLE `_BalanceTransferCandidateCounts`;
DROP TEMPORARY TABLE `_BalanceTransferReceiptCandidates`;

CREATE UNIQUE INDEX `BalanceTransfer_generatedReceiptId_key`
  ON `BalanceTransfer`(`generatedReceiptId`);

ALTER TABLE `BalanceTransfer`
  ADD CONSTRAINT `BalanceTransfer_generatedReceiptId_fkey`
  FOREIGN KEY (`generatedReceiptId`) REFERENCES `Receipt`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

The two count tables enforce uniqueness on both sides before the unique index is created. Verify the confirmed 7-millisecond incident pair links and an intentionally ambiguous fixture stays null during Task 9.

- [ ] **Step 5: Validate generated Prisma artifacts**

Run:

```bash
npx prisma format
npx prisma validate
npx prisma generate
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the schema unit**

```bash
git add prisma/schema.prisma prisma/migrations/20260827090000_balance_transfer_generated_receipt/migration.sql
git commit -m "feat: link balance transfers to generated receipts"
```

---

### Task 2: Build strict transactional audit and the reusable reversal service

**Files:**
- Modify: `src/lib/audit.ts`
- Modify: `src/lib/audit-catalog.ts`
- Create: `src/lib/audit.test.ts`
- Create: `src/lib/balance-transfer-reversal-service.ts`
- Create: `src/lib/balance-transfer-reversal-service.test.ts`
- Test: `src/lib/order-balance-service.test.ts`

**Interfaces:**
- Produces: `recordAuditEventInTransaction(client, event): Promise<void>`.
- Produces: `inspectReceiptEditTransferImpact(tx, input): Promise<ReceiptEditTransferImpact | null>`.
- Produces: `reverseBalanceTransferInTransaction(tx, input): Promise<BalanceTransferReversalResult>`.
- Produces: `reverseTransferReceipt(params): Promise<{ message: string; alreadyReversed: boolean; result?: BalanceTransferReversalResult }>`.

- [ ] **Step 1: Write failing strict-audit tests**

Add tests proving:

```ts
await recordAuditEventInTransaction(tx, event);
expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: event.action }) });

tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
await expect(recordAuditEventInTransaction(tx, event)).rejects.toThrow('audit unavailable');
```

Run:

```bash
npm test -- --runInBand src/lib/audit.test.ts
```

Expected: FAIL because the strict transaction function does not exist.

- [ ] **Step 2: Implement strict audit without changing existing fallback behavior**

Keep `recordAuditEvent` unchanged for existing callers. Add a transaction-client writer that calls `client.auditLog.create` directly and never catches the failure. Add audit actions:

```ts
ORDER_TRANSFER_BALANCE_REVERSE: 'ORDER_TRANSFER_BALANCE_REVERSE',
RECEIPT_UPDATE_WITH_TRANSFER_REVERSAL: 'RECEIPT_UPDATE_WITH_TRANSFER_REVERSAL',
```

Add target type:

```ts
BALANCE_TRANSFER: 'BALANCE_TRANSFER',
```

- [ ] **Step 3: Write failing reversal-domain tests**

Create tests for:

```ts
it('reverses one linked transfer and restores source and target balances atomically')
it('does not treat an unlinked TRANSFER prefix as reversible')
it('denies SALES and USER')
it('does not decrement the source amount twice on repeated or concurrent calls')
it('retains formal source orders')
it('deletes an empty zero-value Un_Associated source order and its aliases')
it('retains a pool source with receipts, merged receipts, tracker links, or another transfer')
it('rolls back when strict audit writing fails')
it('detects exactly one edit-time transfer and rejects ambiguity')
```

Use the incident-equivalent amounts:

```ts
const source = { amount: 3213, orderBalance: 3213, invoice: { invNo: 'Un_Associated' } };
const target = { amount: 13666, orderBalance: 7240 };
const realReceipt = { receiptNo: '0001170', usd: 3213 };
const syntheticReceipt = { receiptNo: 'TRANSFER-1787794481934', usd: 3213 };
expect(result.targetBalanceAfter).toBe(10453);
```

Run:

```bash
npm test -- --runInBand src/lib/balance-transfer-reversal-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement transfer-impact inspection**

`inspectReceiptEditTransferImpact` must query by all accounting identities, not display strings alone:

```ts
type ReceiptEditTransferImpactInput = {
  receiptId: string;
  currentOrderId: string | null;
  nextOrderId: string | null;
  amount: number;
};
```

Return null when the order does not move or no transfer exists. Return one structured impact only when source, target, amount, and generated Receipt link agree. Throw a readable conflict if candidates exist but are ambiguous or unlinked.

- [ ] **Step 5: Implement transactional reversal**

The implementation order is:

```ts
const claim = await tx.balanceTransfer.deleteMany({
  where: { id: transferId, generatedReceiptId: expectedGeneratedReceiptId },
});
if (claim.count !== 1) throw staleOrAlreadyReversedError();

await tx.receipt.delete({ where: { id: expectedGeneratedReceiptId } });
await tx.order.update({
  where: { id: fromOrderId },
  data: { amount: { decrement: transferAmount } },
});

await updateOrderBalance(fromOrderId, tx, { actorId, source });
await updateOrderBalance(toOrderId, tx, { actorId, source });
await cleanupSafeSystemPoolSourceOrder(tx, fromOrderId);
await recordAuditEventInTransaction(tx, auditEvent);
```

Reload every row inside the transaction before claiming. Validate ADMIN, visibility, `TRANSFER-*`, linked IDs, status, amount, and unsupported downstream references. The public wrapper checks prior reversal audit by synthetic Receipt ID to return an idempotent localized success instead of changing amount twice.

- [ ] **Step 6: Verify and commit the reversal unit**

Run:

```bash
npm test -- --runInBand src/lib/audit.test.ts src/lib/balance-transfer-reversal-service.test.ts src/lib/order-balance-service.test.ts
npm run typecheck
git diff --check
```

Expected: all tests and typecheck pass.

```bash
git add src/lib/audit.ts src/lib/audit.test.ts src/lib/audit-catalog.ts src/lib/balance-transfer-reversal-service.ts src/lib/balance-transfer-reversal-service.test.ts
git commit -m "feat: add transactional balance transfer reversal"
```

---

### Task 3: Make all new balance transfers create the explicit link atomically

**Files:**
- Modify: `src/lib/invoice-service.ts`
- Modify: `src/lib/invoice-service.test.ts`

**Interfaces:**
- Consumes: strict transaction audit and explicit `generatedReceiptId` relation.
- Preserves: `transferInvoiceBalance(currentUser, payload)` API contract and success text.

- [ ] **Step 1: Strengthen the existing failing transfer test**

Update the test to require the generated Receipt ID in the transfer row, balance writes against the same transaction client, and strict audit before commit:

```ts
expect(tx.receipt.create).toHaveBeenCalled();
expect(tx.balanceTransfer.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ generatedReceiptId: 'transfer-receipt-1' }),
});
expect(mockUpdateOrderBalance).toHaveBeenCalledWith('source-order', tx, expect.any(Object));
expect(mockUpdateOrderBalance).toHaveBeenCalledWith('target-order', tx, expect.any(Object));
```

Run:

```bash
npm test -- --runInBand src/lib/invoice-service.test.ts -t "transfer"
```

Expected: FAIL because current creation does not retain the Receipt result or link it.

- [ ] **Step 2: Refactor the write order inside the existing transaction**

Create the synthetic Receipt, capture its ID, create `BalanceTransfer` with `generatedReceiptId`, increment source amount, recalculate both balances using `updateOrderBalance` imported directly from `src/lib/order-balance-service.ts`, and write strict audit evidence before commit. Remove the current post-transaction balance and audit writes for this path.

- [ ] **Step 3: Verify rollback and unchanged public behavior**

Add cases where Receipt creation, balance calculation, or audit fails and assert no successful result is returned. Confirm the Receipt still uses `Bank_Transfer`, existing payer/note text, and the same target matching behavior.

Run:

```bash
npm test -- --runInBand src/lib/invoice-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/invoice-service.ts src/lib/invoice-service.test.ts
git commit -m "fix: create linked transfer receipts atomically"
```

---

### Task 4: Unify direct and approved Receipt edits behind one transfer-aware executor

**Files:**
- Create: `src/lib/receipt-edit-apply-service.ts`
- Create: `src/lib/receipt-edit-apply-service.test.ts`
- Modify: `src/lib/receipt-service.ts`
- Modify: `src/lib/receipt-service.test.ts`
- Modify: `src/lib/receipt-edit-request-service.ts`
- Modify: `src/lib/receipt-edit-request-service.test.ts`
- Modify: `src/lib/receipt-edit-types.ts`
- Modify: `src/lib/api-error.ts`
- Modify: `src/lib/api-error-catalog.ts`

**Interfaces:**
- Consumes: `inspectReceiptEditTransferImpact` and `reverseBalanceTransferInTransaction`.
- Produces: `applyReceiptEditInTransaction(input): Promise<{ receipt; touchedOrderIds; reversedTransferId }>`.
- Adds optional `expectedBalanceTransferId` to direct update and approval input, never to SALES request creation.

- [ ] **Step 1: Write failing shared-executor tests**

Cover:

```ts
it('applies a normal edit without transfer reversal')
it('returns RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED before any write')
it('revalidates the expected transfer and reverses before rebinding')
it('rejects a stale or wrong expected transfer ID')
it('rolls back reversal when Receipt history, binding, Detail sync, or draft sync fails')
```

The required-confirmation error detail must contain only:

```ts
{
  balanceTransferId,
  transferReceiptNo,
  sourceOrderNo,
  targetOrderNo,
  amount,
}
```

Run:

```bash
npm test -- --runInBand src/lib/receipt-edit-apply-service.test.ts
```

Expected: FAIL because the executor does not exist.

- [ ] **Step 2: Extract the duplicated edit implementation**

Move binding resolution, Receipt history, Receipt update, Detail Item synchronization, matched-customer snapshot, and pending generator draft synchronization into `applyReceiptEditInTransaction`. Reload the Receipt in the transaction; do not trust an object loaded before it.

Add the machine-readable `RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED` error code and server-side Chinese/English catalog entry in this task so the new executor remains type-safe and independently testable.

Before any edit write:

```ts
const impact = await inspectReceiptEditTransferImpact(tx, {
  receiptId,
  currentOrderId: receipt.orderId,
  nextOrderId: binding.orderId,
  amount: Number(receipt.usd),
});

if (impact && !expectedBalanceTransferId) {
  throw transferReversalRequired(impact);
}
if (impact) {
  assertExpectedTransfer(impact, expectedBalanceTransferId);
  await reverseBalanceTransferInTransaction(tx, { ... });
}
```

- [ ] **Step 3: Connect direct ADMIN edits**

`updateReceiptRecord` keeps its current ADMIN and visibility checks, then calls the shared executor inside `runInTransaction`. Pass the transaction client to balance recalculation and strict audit; remove duplicated post-transaction balance writes. Preserve Receipt-number conflict handling.

- [ ] **Step 4: Connect SALES approval**

`reviewReceiptEdit` accepts `expectedBalanceTransferId?: string | null`. For `approve`, call the shared executor before marking the request approved, or keep both operations in the same transaction so a confirmation-required/stale failure leaves the request `PENDING`. `reject` stays unchanged and never reverses anything.

- [ ] **Step 5: Verify the two callers use identical behavior**

Run:

```bash
npm test -- --runInBand src/lib/receipt-edit-apply-service.test.ts src/lib/receipt-service.test.ts src/lib/receipt-edit-request-service.test.ts
npm run typecheck
```

Expected: PASS, including pending signed-receipt draft regressions from the previous release.

- [ ] **Step 6: Commit**

```bash
git add src/lib/receipt-edit-apply-service.ts src/lib/receipt-edit-apply-service.test.ts src/lib/receipt-service.ts src/lib/receipt-service.test.ts src/lib/receipt-edit-request-service.ts src/lib/receipt-edit-request-service.test.ts src/lib/receipt-edit-types.ts src/lib/api-error.ts src/lib/api-error-catalog.ts
git commit -m "fix: reverse duplicate transfers during receipt edits"
```

---

### Task 5: Expose narrow API contracts and complete English localization

**Files:**
- Modify: `src/app/api/receipt/route.ts`
- Modify: `src/app/api/receipt/route.test.ts`
- Modify: `src/lib/api-error.ts`
- Modify: `src/lib/api-error-catalog.ts`
- Modify: `src/lib/api-success-catalog.ts`
- Modify: `src/lib/api-success-catalog.test.ts`
- Modify: `src/i18n/workspace/api-error-map.ts`
- Modify: `src/lib/store.ts`

**Interfaces:**
- Adds Receipt action `reverse-transfer` with `{ receiptId }` only.
- Adds optional `expectedBalanceTransferId` to `update` and `review-edit` actions.
- GET Receipt row adds `isSystemTransfer: boolean`; it does not expose source amount or accept browser-supplied accounting values.

- [ ] **Step 1: Write failing route and localization tests**

Add route tests proving:

```ts
await POST(requestFor({ action: 'reverse-transfer', receiptId: 'transfer-receipt-1' }));
expect(reverseTransferReceipt).toHaveBeenCalledWith({ currentUser, receiptId: 'transfer-receipt-1' });

expect(updateReceiptRecord).toHaveBeenCalledWith(expect.objectContaining({
  expectedBalanceTransferId: 'transfer-1',
}));
```

Add exact English assertions:

```ts
expect(translateApiSuccessMessage('收据修改申请已提交，等待管理员同意', 'en'))
  .toBe('Receipt edit request submitted. Waiting for administrator approval.');
expect(translateApiSuccessMessage('修改已完成', 'en')).toBe('Update completed.');
expect(translateApiSuccessMessage('余额转移已撤销', 'en')).toBe('Balance transfer reversed.');
```

Run:

```bash
npm test -- --runInBand src/app/api/receipt/route.test.ts src/lib/api-success-catalog.test.ts
```

Expected: FAIL before implementation.

- [ ] **Step 2: Add machine-readable error codes and bilingual messages**

Add the remaining machine-readable reversal conflict code:

```ts
BALANCE_TRANSFER_REVERSAL_CONFLICT
```

Map both server and browser catalogs. The confirmation-required code must remain machine-readable while its displayed text is localized.

- [ ] **Step 3: Extend Receipt GET safely**

Include only the transfer relation ID needed to derive:

```ts
isSystemTransfer: Boolean(receipt.generatedByBalanceTransfer)
```

Strip the relation object from the JSON row. Extend `Receipt` in `src/lib/store.ts` with `isSystemTransfer?: boolean`.

- [ ] **Step 4: Route the new and confirmed actions**

Parse `expectedBalanceTransferId` only as a string or null. Do not accept amount, source order, target order, or source amount for reversal. Return all success responses through `createApiSuccessResponse` so locale selection is consistent.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- --runInBand src/app/api/receipt/route.test.ts src/lib/api-success-catalog.test.ts src/components/workspace/api/client.test.ts
npm run typecheck
```

Expected: PASS.

```bash
git add src/app/api/receipt/route.ts src/app/api/receipt/route.test.ts src/lib/api-error.ts src/lib/api-error-catalog.ts src/lib/api-success-catalog.ts src/lib/api-success-catalog.test.ts src/i18n/workspace/api-error-map.ts src/lib/store.ts
git commit -m "feat: expose localized transfer reversal APIs"
```

---

### Task 6: Add ADMIN reversal and edit-confirmation UI without changing ordinary deletion

**Files:**
- Modify: `src/components/workspace/modules/receipts/components/receipt-list.tsx`
- Modify: `src/components/workspace/modules/receipts/components/receipt-list.test.tsx`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts`
- Modify: `src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.tsx`
- Modify: `src/components/workspace/modules/receipts/receipt-manager.test.tsx`

**Interfaces:**
- `ReceiptList` adds `onReverseTransfer(receiptId)`.
- `useReceiptActions` adds `handleReverseTransfer` and transparent confirmation/retry for update and approval.

- [ ] **Step 1: Write failing visibility and action tests**

Assert:

```ts
expect(screen.getByTitle('Reverse transfer')).toBeInTheDocument(); // ADMIN + linked system transfer
expect(screen.queryByTitle('Reverse transfer')).not.toBeInTheDocument(); // SALES/USER or ordinary Bank_Transfer
expect(screen.queryByTitle('Request deletion')).not.toBeInTheDocument(); // linked transfer still bypasses generic deletion
```

Run:

```bash
npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-list.test.tsx
```

Expected: FAIL because the control does not exist.

- [ ] **Step 2: Add the dedicated row control**

Use a compact existing Lucide icon and bilingual title. Render only when:

```ts
isAdmin && receipt.status === 'Bank_Transfer' && receipt.isSystemTransfer
```

Do not change `canDeleteThisReceipt`; normal `Bank_Transfer` deletion stays hidden.

- [ ] **Step 3: Write failing confirmation/retry hook tests**

Simulate `WorkspaceApiError` with code `RECEIPT_EDIT_TRANSFER_REVERSAL_REQUIRED` and structured detail. Verify:

```ts
expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Reverse the transfer and modify the receipt'));
expect(mockApiCall).toHaveBeenLastCalledWith('receipt', expect.objectContaining({
  body: expect.stringContaining('"expectedBalanceTransferId":"transfer-1"'),
}));
```

Cover direct ADMIN edit, ADMIN approval, cancel, stale retry failure, English text, and no confirmation for ordinary edits.

- [ ] **Step 4: Implement the confirmation/retry helper**

Catch only `WorkspaceApiError` with the exact machine code. Validate its detail shape before showing the prompt. A confirmed retry sends only `expectedBalanceTransferId`; a canceled prompt returns without an error alert or write. Every other error follows the existing error path.

Add the dedicated reversal confirmation:

```text
ZH: 确定撤销这笔余额转移吗？系统生成的转移收据将被删除，并重新计算两个订单的余额。
EN: Reverse this balance transfer? The generated transfer receipt will be removed and both order balances will be recalculated.
```

- [ ] **Step 5: Verify UI wiring and commit**

Run:

```bash
npm test -- --runInBand src/components/workspace/modules/receipts/components/receipt-list.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
npm run typecheck
```

Expected: PASS.

```bash
git add src/components/workspace/modules/receipts/components/receipt-list.tsx src/components/workspace/modules/receipts/components/receipt-list.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.ts src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
git commit -m "feat: confirm and reverse duplicate receipt transfers"
```

---

### Task 7: Add isolated API coverage for permissions, accounting, and the exact incident

**Files:**
- Create: `tests/api/isolated/cases/69-receipt-transfer-reversal.case.mjs`

**Interfaces:**
- Exercises authenticated public Receipt and Invoice APIs against a disposable database.
- Does not connect to `192.168.1.3:3306` or the NAS upload directory.

- [ ] **Step 1: Write the isolated incident fixture**

Seed through APIs where possible, with direct isolated Prisma setup only for the historical legacy-link fixture. Create:

```text
source order: Super DT2-08 B / Un_Associated
target order: SUPER DT2-08B / L25MH090002B / amount 13,666
real receipt: 0001170 / 3,213
synthetic transfer: TRANSFER-1787794481934 / 3,213
expected wrong target balance before reversal: 7,240
expected correct target balance after reversal: 10,453
```

- [ ] **Step 2: Cover role and ordinary deletion boundaries**

Assert USER and SALES receive `403`; ADMIN succeeds. Assert a non-linked `Bank_Transfer` receipt cannot use `reverse-transfer` and remains protected by ordinary deletion rules.

- [ ] **Step 3: Cover direct-edit and approval confirmation**

Build one direct ADMIN case and one SALES-request/ADMIN-approval case. First call returns confirmation-required with no changed rows; confirmed retry moves the real Receipt, removes the synthetic transfer, fixes both balances, and leaves Detail Item linkage correct.

- [ ] **Step 4: Cover rollback and idempotency**

Use stale IDs and repeated requests to verify source amount is decremented once. Verify an ambiguous fixture is blocked and neither Receipt nor balance changes.

- [ ] **Step 5: Run the isolated case alone**

Run:

```bash
npm run test:api:isolated -- --case 69-receipt-transfer-reversal
```

Expected: the new case passes with no access to existing business data.

- [ ] **Step 6: Commit**

```bash
git add tests/api/isolated/cases/69-receipt-transfer-reversal.case.mjs
git commit -m "test: cover receipt transfer reversal flow"
```

---

### Task 8: Complete documentation, versioning, full verification, and PR review

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `ENGINEERING_LOG.md`
- Modify: `docs/data-and-integrations.md`
- Modify: `docs/backup/muledger-local-backup.md`
- Modify: `docs/superpowers/plans/README.md`

**Interfaces:**
- Produces release version `1.0.213` unless latest `main` already uses that version, in which case increment exactly once from the synchronized value.
- Documents that the complete MySQL snapshot covers `BalanceTransfer.generatedReceiptId`; no new file backup path exists.

- [ ] **Step 1: Synchronize latest main before final verification**

```bash
git fetch origin main
git rebase origin/main
```

Expected: clean rebase. If upstream changed any touched file, rerun all targeted tests after resolving without dropping either side's behavior.

- [ ] **Step 2: Update version and concise user documentation**

Run `npm version 1.0.213 --no-git-tag-version` only if `origin/main` is still `1.0.212`. README's latest update should say that Receipt transfer reversal now prevents duplicate payment and English edit feedback is fixed. Keep implementation detail in `ENGINEERING_LOG.md`, not README.

Update the backup runbook with:

- the new balance-transfer-to-Receipt relationship inside the complete database dump;
- the required pre-migration backup verification;
- isolated migration/backfill checks;
- the one-time `TRANSFER-1787794481934` repair postconditions.

- [ ] **Step 3: Run targeted and full gates**

```bash
npx prisma format
npx prisma validate
npx prisma generate
npm test -- --runInBand src/lib/audit.test.ts src/lib/balance-transfer-reversal-service.test.ts src/lib/invoice-service.test.ts src/lib/receipt-edit-apply-service.test.ts src/lib/receipt-service.test.ts src/lib/receipt-edit-request-service.test.ts src/app/api/receipt/route.test.ts src/lib/api-success-catalog.test.ts src/components/workspace/modules/receipts/components/receipt-list.test.tsx src/components/workspace/modules/receipts/hooks/use-receipt-actions.test.tsx src/components/workspace/modules/receipts/receipt-manager.test.tsx
npm run test:api:isolated -- --case 69-receipt-transfer-reversal
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:api:isolated
npm run test:e2e:isolated
npm run build
git diff --check
```

Expected: every command exits `0`; report exact test counts and any warnings.

- [ ] **Step 4: Commit release metadata**

```bash
git add package.json package-lock.json README.md ENGINEERING_LOG.md docs/data-and-integrations.md docs/backup/muledger-local-backup.md docs/superpowers/plans/README.md
git commit -m "chore: release receipt transfer reversal"
```

Omit unchanged optional files from `git add`.

- [ ] **Step 5: Push, create PR, and wait for all CI**

```bash
git push -u origin fix/receipt-transfer-reversal-20260827
cat > /tmp/muledger-receipt-transfer-pr.md <<'EOF'
## Summary
- link each balance transfer to its generated Receipt
- reverse duplicate transfers transactionally during ADMIN actions and Receipt edits
- localize Receipt edit and transfer reversal feedback

## Verification
- targeted Jest and isolated API coverage
- full typecheck, lint, Jest, isolated API, isolated E2E, and production build
- isolated backup restore and migration rehearsal documented before live rollout

## Data safety
- additive nullable relationship with conservative unique backfill
- no new media path or external persistence
- production repair runs only after a fresh verified snapshot and isolated restore rehearsal
EOF
gh pr create --base main --head fix/receipt-transfer-reversal-20260827 --title "Fix receipt transfer reversal accounting" --body-file /tmp/muledger-receipt-transfer-pr.md
gh pr checks --watch
```

Review the complete diff with a code-review mindset. Post review findings or approval to the online PR. Do not merge while any required check is pending or failing.

---

### Task 9: Rehearse migration and repair, merge, back up, repair live data, and safely rebuild

**Files:**
- Create: `docs/backup/restore-drills/2026-08-27-receipt-transfer-reversal-migration-drill.md`

**Interfaces:**
- Uses the existing NAS backup script and a disposable MariaDB 10.6 container.
- Live repair calls `POST /api/receipt` with `{ action: "reverse-transfer", receiptId: "cmtauoavj005pn701lzrs1rlz" }` through an authenticated ADMIN session.

- [ ] **Step 1: Run backup dry-run and create a fresh verified snapshot**

```bash
scripts/backup/muledger-local-backup.sh --dry-run
scripts/backup/muledger-local-backup.sh
LATEST_SNAPSHOT="$(find /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots -mindepth 4 -maxdepth 4 -type d -name 'muledger-*' | sort | tail -1)"
test -n "$LATEST_SNAPSHOT"
scripts/backup/muledger-local-backup.sh --verify "$LATEST_SNAPSHOT"
```

Expected: all commands exit `0`; manifest and both database/media checksums pass.

- [ ] **Step 2: Restore the exact snapshot into disposable MariaDB**

Run:

```bash
DRILL_ID="muledger-transfer-$(date +%Y%m%d%H%M%S)"
DRILL_ROOT="/tmp/$DRILL_ID"
DRILL_DB_CONTAINER="$DRILL_ID-db"
DRILL_DB_PORT=33317
DRILL_DB_PASSWORD="$(openssl rand -hex 24)"
LATEST_SNAPSHOT="$(find /Volumes/团队文件-DAINTY_SHIPMENT/docker/backups/muledger/snapshots -mindepth 4 -maxdepth 4 -type d -name 'muledger-*' | sort | tail -1)"
test -n "$LATEST_SNAPSHOT"
! lsof -nP -iTCP:"$DRILL_DB_PORT" -sTCP:LISTEN
mkdir -p "$DRILL_ROOT/media"

DB_DUMP_REL="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.database.file)' "$LATEST_SNAPSHOT/manifest.json")"
MEDIA_REL="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.media.file)' "$LATEST_SNAPSHOT/manifest.json")"

docker run -d --name "$DRILL_DB_CONTAINER" \
  --tmpfs /var/lib/mysql:rw,size=1g \
  -p "127.0.0.1:${DRILL_DB_PORT}:3306" \
  -e MARIADB_ROOT_PASSWORD="$DRILL_DB_PASSWORD" \
  -e MARIADB_DATABASE=trading_ledger \
  mariadb:10.6

for attempt in $(seq 1 60); do
  if docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb-admin ping -uroot --silent; then break; fi
  test "$attempt" -lt 60
  sleep 1
done

gzip -dc "$LATEST_SNAPSHOT/$DB_DUMP_REL" \
  | docker exec -i -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot trading_ledger
tar -xzf "$LATEST_SNAPSHOT/$MEDIA_REL" -C "$DRILL_ROOT/media"

for table in Order Invoice Receipt BalanceTransfer Detail DetailItem AuditLog; do
  docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" \
    mariadb -uroot -N trading_ledger -e "SELECT '${table}', COUNT(*) FROM \`${table}\`;"
done | tee "$DRILL_ROOT/pre-migration-counts.txt"

for table in Order Invoice Receipt Detail DetailItem AuditLog; do
  docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" \
    mariadb-dump -uroot --no-create-info --skip-extended-insert --order-by-primary trading_ledger "$table"
done | shasum -a 256 | tee "$DRILL_ROOT/pre-migration-business.sha256"
```

Expected: the container uses tmpfs only, binds only to loopback, restores the exact dump and media archive, and records pre-migration evidence without any production mount.

- [ ] **Step 3: Apply migration and verify unique and ambiguous backfill in isolation**

Before migration, create an isolated ambiguous pair using the confirmed transfer as a template:

```bash
docker exec -i -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot trading_ledger <<'SQL'
INSERT INTO `BalanceTransfer` (`id`, `fromOrderId`, `toOrderId`, `amount`, `note`, `createdBy`, `createdAt`)
SELECT 'drill-ambiguous-transfer', `fromOrderId`, `toOrderId`, 1.23, 'migration ambiguity fixture', `createdBy`, `createdAt`
FROM `BalanceTransfer` WHERE `id` = 'cmtauoavc005nn701ueemain2';

INSERT INTO `Receipt` (`id`, `receiptNo`, `date`, `tel`, `usd`, `invNo`, `orderNo`, `payer`, `status`, `imageUrl`, `imageName`, `isDeposit`, `isMerged`, `mergedToId`, `customerId`, `customerMark`, `customerName`, `customerPhone`, `customerCity`, `needsCustomerFix`, `note`, `createdBy`, `createdAt`, `updatedAt`, `orderId`)
SELECT 'drill-ambiguous-receipt-a', 'TRANSFER-DRILL-A', `date`, `tel`, 1.23, `invNo`, `orderNo`, `payer`, `status`, NULL, NULL, `isDeposit`, `isMerged`, `mergedToId`, `customerId`, `customerMark`, `customerName`, `customerPhone`, `customerCity`, `needsCustomerFix`, `note`, `createdBy`, `createdAt`, `updatedAt`, `orderId`
FROM `Receipt` WHERE `id` = 'cmtauoavj005pn701lzrs1rlz';

INSERT INTO `Receipt` (`id`, `receiptNo`, `date`, `tel`, `usd`, `invNo`, `orderNo`, `payer`, `status`, `imageUrl`, `imageName`, `isDeposit`, `isMerged`, `mergedToId`, `customerId`, `customerMark`, `customerName`, `customerPhone`, `customerCity`, `needsCustomerFix`, `note`, `createdBy`, `createdAt`, `updatedAt`, `orderId`)
SELECT 'drill-ambiguous-receipt-b', 'TRANSFER-DRILL-B', `date`, `tel`, 1.23, `invNo`, `orderNo`, `payer`, `status`, NULL, NULL, `isDeposit`, `isMerged`, `mergedToId`, `customerId`, `customerMark`, `customerName`, `customerPhone`, `customerCity`, `needsCustomerFix`, `note`, `createdBy`, `createdAt`, `updatedAt`, `orderId`
FROM `Receipt` WHERE `id` = 'cmtauoavj005pn701lzrs1rlz';
SQL

DRILL_DATABASE_URL="mysql://root:${DRILL_DB_PASSWORD}@127.0.0.1:${DRILL_DB_PORT}/trading_ledger"
DATABASE_URL="$DRILL_DATABASE_URL" npx prisma migrate deploy
DATABASE_URL="$DRILL_DATABASE_URL" npx prisma migrate deploy
```

The second migration run must report no pending migrations. Verify:

```sql
SELECT bt.id, bt.generatedReceiptId, r.receiptNo
FROM BalanceTransfer bt
LEFT JOIN Receipt r ON r.id = bt.generatedReceiptId;
```

Run the assertion and remove only the isolated fixture:

```bash
docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot -N trading_ledger -e \
  "SELECT id, COALESCE(generatedReceiptId, 'NULL') FROM BalanceTransfer WHERE id IN ('cmtauoavc005nn701ueemain2', 'drill-ambiguous-transfer') ORDER BY id;" \
  | tee "$DRILL_ROOT/backfill-result.txt"
grep -F $'cmtauoavc005nn701ueemain2\tcmtauoavj005pn701lzrs1rlz' "$DRILL_ROOT/backfill-result.txt"
grep -F $'drill-ambiguous-transfer\tNULL' "$DRILL_ROOT/backfill-result.txt"

docker exec -i -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot trading_ledger <<'SQL'
DELETE FROM `BalanceTransfer` WHERE `id` = 'drill-ambiguous-transfer';
DELETE FROM `Receipt` WHERE `id` IN ('drill-ambiguous-receipt-a', 'drill-ambiguous-receipt-b');
SQL

for table in Order Invoice Receipt BalanceTransfer Detail DetailItem AuditLog; do
  docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" \
    mariadb -uroot -N trading_ledger -e "SELECT '${table}', COUNT(*) FROM \`${table}\`;"
done | tee "$DRILL_ROOT/post-migration-counts.txt"
diff -u "$DRILL_ROOT/pre-migration-counts.txt" "$DRILL_ROOT/post-migration-counts.txt"

for table in Order Invoice Receipt Detail DetailItem AuditLog; do
  docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" \
    mariadb-dump -uroot --no-create-info --skip-extended-insert --order-by-primary trading_ledger "$table"
done | shasum -a 256 | tee "$DRILL_ROOT/post-migration-business.sha256"
diff -u "$DRILL_ROOT/pre-migration-business.sha256" "$DRILL_ROOT/post-migration-business.sha256"
```

Expected: the confirmed unique pair links, the ambiguous pair remains null, row counts match after fixture cleanup, and all non-transfer protected row fingerprints remain identical.

- [ ] **Step 4: Exercise reversal against the isolated restored copy**

Run the built application against the disposable database and call the authenticated API with a short-lived drill token:

```bash
DRILL_APP_PORT=33318
DRILL_SESSION_SECRET="$(openssl rand -hex 32)"
! lsof -nP -iTCP:"$DRILL_APP_PORT" -sTCP:LISTEN

NODE_ENV=production PORT="$DRILL_APP_PORT" HOSTNAME=127.0.0.1 \
DATABASE_URL="$DRILL_DATABASE_URL" SESSION_SECRET="$DRILL_SESSION_SECRET" \
MAINTENANCE_JOB_TOKEN="$(openssl rand -hex 32)" TRUST_PROXY_HEADERS=false \
node .next/standalone/server.js > "$DRILL_ROOT/app.log" 2>&1 &
DRILL_APP_PID=$!
echo "$DRILL_APP_PID" > "$DRILL_ROOT/app.pid"

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${DRILL_APP_PORT}/api/system/health" >/dev/null; then break; fi
  test "$attempt" -lt 60
  sleep 1
done

DRILL_ADMIN_ID="$(docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot -N trading_ledger -e "SELECT id FROM User WHERE role='ADMIN' ORDER BY level, id LIMIT 1;")"
DRILL_SESSION_TOKEN="$(DRILL_ADMIN_ID="$DRILL_ADMIN_ID" DRILL_SESSION_SECRET="$DRILL_SESSION_SECRET" node <<'NODE'
const { createHmac } = require('node:crypto');
const payload = Buffer.from(JSON.stringify({
  userId: process.env.DRILL_ADMIN_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
}), 'utf8').toString('base64url');
const signature = createHmac('sha256', process.env.DRILL_SESSION_SECRET).update(payload).digest('base64url');
process.stdout.write(`${payload}.${signature}`);
NODE
)"

curl -fsS -X POST "http://127.0.0.1:${DRILL_APP_PORT}/api/receipt" \
  -H 'Content-Type: application/json' \
  -H "Cookie: tls_session=${DRILL_SESSION_TOKEN}" \
  --data '{"action":"reverse-transfer","receiptId":"cmtauoavj005pn701lzrs1rlz"}' \
  | tee "$DRILL_ROOT/reversal-response.json"

node -e 'const r=require(process.argv[1]); if (!r.success) process.exit(1)' "$DRILL_ROOT/reversal-response.json"
docker exec -e MYSQL_PWD="$DRILL_DB_PASSWORD" "$DRILL_DB_CONTAINER" mariadb -uroot -N trading_ledger <<'SQL' | tee "$DRILL_ROOT/post-reversal-invariants.txt"
SELECT 'synthetic_receipt_count', COUNT(*) FROM Receipt WHERE id='cmtauoavj005pn701lzrs1rlz';
SELECT 'transfer_count', COUNT(*) FROM BalanceTransfer WHERE id='cmtauoavc005nn701ueemain2';
SELECT 'real_receipt', receiptNo, status, usd, orderNo, invNo FROM Receipt WHERE id='cmszqlas40324mg01dy8ixzmg';
SELECT 'target_balance', orderBalance FROM `Order` WHERE id='cmoqk9wwv01ptuc01yyb6okvr';
SELECT 'source_order_count', COUNT(*) FROM `Order` WHERE id='cmszqlaro0322mg01m25ueq3o';
SELECT 'reversal_audit_count', COUNT(*) FROM AuditLog WHERE action='ORDER_TRANSFER_BALANCE_REVERSE' AND targetId='cmtauoavc005nn701ueemain2';
SQL
```

Expected: both deleted counts are `0`, real Receipt `0001170` remains `RECEIVED` for `$3,213` on `SUPER DT2-08B` / `L25MH090002B`, target balance is `10453.00`, source order count is `0`, and reversal audit count is `1`.

- [ ] **Step 5: Save drill evidence and update the PR**

Write exact snapshot ID, temporary container identity, migration output, before/after counts, fingerprints, SQL assertions, API response, and cleanup command to the restore-drill document. Commit and push it, then wait for CI again.

- [ ] **Step 6: Synchronize and merge only after green CI**

```bash
git fetch origin main
git rebase origin/main
git push --force-with-lease
gh pr checks --watch
gh pr merge --merge --delete-branch
```

Then update the main checkout with `git pull --ff-only`. Never merge if the rebase changes tested behavior without rerunning the full relevant gates.

- [ ] **Step 7: Apply the production migration through the safe rebuild**

Confirm the fresh snapshot is still valid, then run `scripts/rebuild-local-app.sh`. The app container command applies `npx prisma migrate deploy` before starting Next.js. Do not run a second production migration command in parallel. If the script fails, capture the complete output, failed stage, exit code, relevant `docker compose logs --tail=120`, and whether MySQL, Docker volumes, NAS uploads, or generated files were touched.

- [ ] **Step 8: Execute the one-time ADMIN repair and verify invariants**

Before calling the API, re-read all four IDs and amounts. Abort if any precondition differs. After the call, query read-only invariants and confirm:

```text
TRANSFER-1787794481934: absent
BalanceTransfer cmtauoavc005nn701ueemain2: absent
Receipt 0001170: RECEIVED, $3,213, SUPER DT2-08B, L25MH090002B
Target order cmoqk9wwv01ptuc01yyb6okvr balance: $10,453
Source order cmszqlaro0322mg01m25ueq3o: absent
Audit reversal record: present with before/after values
```

Use a short-lived ADMIN session token generated inside the running app container and call only the public API:

```bash
LIVE_SESSION_TOKEN="$(docker compose exec -T app node <<'NODE'
const { createHmac } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: [{ level: 'asc' }, { id: 'asc' }] });
  if (!admin) process.exit(2);
  const payload = Buffer.from(JSON.stringify({ userId: admin.id, exp: Math.floor(Date.now() / 1000) + 300 }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
  process.stdout.write(`${payload}.${signature}`);
  await prisma.$disconnect();
})().catch(async () => { await prisma.$disconnect(); process.exit(3); });
NODE
)"

curl -fsS -X POST https://localhost/api/receipt \
  -H 'Content-Type: application/json' \
  -H "Cookie: tls_session=${LIVE_SESSION_TOKEN}" \
  --data '{"action":"reverse-transfer","receiptId":"cmtauoavj005pn701lzrs1rlz"}'
unset LIVE_SESSION_TOKEN
```

Do not print or persist the token. Run read-only postcondition queries immediately after the response.

- [ ] **Step 9: Verify the running service and clean isolation resources**

Verify package/UI version, `docker compose ps`, app logs, `/api/system/health`, authenticated Receipt API, public HTTPS, database connection, and NAS mount. Then remove only the disposable resources:

```bash
kill "$(cat "$DRILL_ROOT/app.pid")" 2>/dev/null || true
docker rm -f "$DRILL_DB_CONTAINER"
rm -rf "$DRILL_ROOT"
```

Never remove production volumes or backup snapshots.
