# Receipt Transfer Reversal and Duplicate-Payment Prevention Design

Date: 2026-08-27

Status: Approved approach in conversation; pending written-spec review

## 1. Purpose

Fix one confirmed duplicate-payment incident and prevent the same accounting error from recurring:

1. Localize Receipt edit success messages correctly in English.
2. Reverse the duplicate system receipt `TRANSFER-1787794481934` without changing the valid receipt `0001170`.
3. Let an ADMIN explicitly reverse a system-generated `TRANSFER-*` receipt without using the normal deletion approval flow.
4. When an ADMIN moves the original receipt from the transfer source order to the transfer target order, detect the duplicate transfer and require confirmation to reverse it before applying the edit.
5. Remove the resulting empty incorrect `Un_Associated` order only when strict cleanup conditions are satisfied.

## 2. Confirmed Incident and Root Cause

The balance-transfer implementation currently performs three independent-looking effects inside one write:

1. it creates a `BalanceTransfer` row;
2. it increments the source `Order.amount` by the transferred amount;
3. it creates a synthetic `TRANSFER-*` Receipt on the target order.

The later Receipt edit path can move the original real receipt from the source order to the same target order, but it does not inspect or reverse the earlier transfer. The target order then contains both the real receipt and the synthetic transfer receipt, so the payment is counted twice.

The confirmed production records are:

- real receipt `0001170`, amount `$3,213`, now correctly bound to `SUPER DT2-08B` / `L25MH090002B`;
- synthetic receipt `TRANSFER-1787794481934`, amount `$3,213`, also bound to the same target order;
- balance transfer from incorrect source order `Super DT2-08 B` in `Un_Associated` to `SUPER DT2-08B`;
- target stored balance `$7,240`, while the correct balance after reversal is `$10,453`;
- source order currently has amount and balance `$3,213`, no remaining receipts, and should return to `$0` before it is removed.

Normal Receipt deletion cannot repair this incident because it does not delete the `BalanceTransfer` row or reverse the source-order amount adjustment. It must not be reused for transfer reversal.

## 3. Confirmed Business Rules

### 3.1 Transfer identity

- Every newly generated transfer Receipt must have an explicit one-to-one link to its `BalanceTransfer` row.
- A Receipt is treated as a reversible system transfer only when its number starts with `TRANSFER-` and the one-to-one transfer relationship exists.
- A `TRANSFER-*` prefix by itself is not sufficient authority to reverse data.
- Historical rows are linked only when the migration can identify exactly one candidate using target order, amount, creator, source-order text, and a narrow creation-time relationship. Ambiguous rows remain unlinked and cannot be reversed automatically.

### 3.2 ADMIN transfer reversal

- Only `ADMIN` may see or call the dedicated `Reverse transfer` action.
- The action is immediate and does not create a deletion approval request.
- `SALES` and `USER` do not see the action and receive a permission error if they call the API directly.
- Ordinary Receipt deletion rules, including `Bank_Transfer` restrictions, remain unchanged.
- The dedicated action is available only for a linked system transfer Receipt. It is not a generic way to delete other `Bank_Transfer` receipts.

### 3.3 Editing the original receipt after a transfer

Before applying an ADMIN Receipt edit or approving a SALES Receipt edit request, the backend checks whether all of these conditions hold:

- the Receipt's current order is the transfer source;
- the edited binding resolves to the transfer target;
- the Receipt amount equals the transfer amount;
- the transfer has one linked synthetic Receipt;
- exactly one active transfer satisfies the complete relationship.

If exactly one transfer matches, no write is applied on the first request. The UI asks, in the active language, whether to reverse the transfer and modify the receipt. After ADMIN confirmation, the request carries the expected transfer ID. The backend rechecks the complete relationship inside the transaction, reverses that transfer, and applies the Receipt edit atomically.

If no transfer matches, the existing edit behavior continues unchanged. If more than one candidate exists, the relationship changed after confirmation, or the synthetic Receipt has unsupported downstream references, the operation fails safely with a readable error and makes no partial change.

For a SALES request, the SALES user may submit the normal edit request. If approval would cause the duplicate-transfer condition, the ADMIN approving it receives the same confirmation. Rejection never reverses a transfer.

### 3.4 Safe source-order cleanup

- A source order in a formal invoice is never deleted automatically.
- A source order in `Un_Associated` or `DEPOSIT_POOL` may be deleted after reversal only when its restored amount is exactly `$0`, its computed balance is `$0`, no Receipt remains, and no other transfer, Order Tracker link, or other protected business reference remains. Order aliases are matching metadata owned by the Order and are removed with a safely deleted Order; aliases alone do not block cleanup.
- If any cleanup condition fails, the order remains and the audit record explains why it was retained.
- If the source system-pool invoice becomes empty, it is removed only through the existing safe empty-system-invoice rule. Shared system-pool containers required by the application must not be deleted accidentally.

## 4. Data Model and Migration

Add a nullable unique generated-Receipt reference to `BalanceTransfer` and the inverse optional relation on `Receipt`.

The foreign key uses restrictive deletion behavior. Generic Receipt deletion therefore cannot silently orphan a transfer. The reversal service explicitly removes the transfer relationship and both linked business effects in the correct order inside one transaction.

The migration performs a conservative historical backfill:

- it considers only `TRANSFER-*` receipts;
- target order, amount, creator, source-order payer/note text, and creation time must agree;
- exactly one candidate must exist for both sides;
- unmatched or ambiguous records remain null and are reported, not guessed.

The full `trading_ledger` database snapshot already covers the new relationship. No new media directory, Docker volume, NAS path, or third-party persistence is introduced.

## 5. Shared Transactional Reversal Service

Create one transaction-aware balance-transfer reversal module. Both the dedicated ADMIN action and the Receipt-edit confirmation path call this module; neither path reimplements the accounting steps.

Within one database transaction, the service:

1. reloads and validates the transfer, linked Receipt, source order, target order, actor permission, and optional expected IDs;
2. records source amount, source balance, target balance, Receipt IDs, and transfer ID before the change;
3. removes the `BalanceTransfer` row and linked synthetic Receipt in foreign-key-safe order;
4. decrements the source `Order.amount` by exactly the original transfer amount;
5. when invoked by Receipt edit, applies the existing Receipt binding, Receipt history, linked Detail Item, customer snapshot, and pending signed-receipt synchronization changes in the same transaction;
6. recalculates source and target balances through the shared order-balance service using the same transaction client;
7. applies the strict system-pool cleanup rules;
8. writes the reversal and Receipt-edit audit records in the same transaction, including complete before/after values and cleanup result.

Any failed validation, balance write, Receipt edit, cleanup, or audit write rolls back the complete operation. A repeated reversal request returns an idempotent readable result when the transfer was already reversed; it must not decrement the source amount twice.

The transfer creation path is updated to create the synthetic Receipt first, create the `BalanceTransfer` with its explicit Receipt ID, adjust the source amount, recalculate both balances, and write audit evidence as one transaction.

## 6. API and UI

### 6.1 Dedicated reversal

Extend the Receipt API with a narrowly scoped ADMIN action that accepts the transfer Receipt ID. The backend resolves the linked transfer and never accepts a free-form source order, target order, or amount from the browser.

Receipt Management shows a dedicated `Reverse transfer` control only for ADMIN and only when the row is identified by the API as a linked system transfer. The confirmation explains that the synthetic transfer Receipt will be removed and both order balances will be recalculated. After success, Receipt and Invoice data are reloaded.

### 6.2 Edit confirmation

The Receipt edit and edit-approval calls may return a structured `confirmation required` conflict containing only the expected transfer ID, Receipt number, source order, target order, and amount needed for the bilingual prompt.

The confirmed retry sends the expected transfer ID. The server does not trust the displayed amount or order names and revalidates current database state before writing.

### 6.3 Localization

Add exact English success-message mappings for at least:

- `收据修改申请已提交，等待管理员同意`;
- `收据修改申请已通过`;
- `收据修改申请已拒绝`;
- `修改已完成`;
- transfer reversal success and already-reversed outcomes.

Add bilingual error and confirmation text for permission denial, missing transfer linkage, stale confirmation, ambiguous match, unsupported downstream references, and failed safe cleanup. The English Receipt edit flow must never display raw Chinese success text.

## 7. Audit and Observability

Add explicit audit actions for transfer creation, transfer reversal, and combined transfer-reversal Receipt edit. Audit metadata includes:

- actor ID and operation source;
- transfer ID and synthetic Receipt ID/number;
- original Receipt ID/number when editing;
- source and target order IDs/numbers;
- transfer amount;
- source amount before and after;
- source and target balances before and after;
- whether the source order and empty system invoice were removed;
- confirmation transfer ID;
- current incident repair marker when applicable.

Structured application logs contain the same identifying IDs and outcome, but no credentials, image data, or unrelated customer data.

## 8. Current Incident Repair

The production repair is executed only after the migration and application code have passed isolated verification and a fresh backup has been created and verified.

The repair calls the same ADMIN reversal path for `TRANSFER-1787794481934`. Expected postconditions are:

- `TRANSFER-1787794481934` no longer exists;
- its linked `BalanceTransfer` no longer exists;
- real Receipt `0001170` remains `RECEIVED`, amount `$3,213`, linked to `SUPER DT2-08B` / `L25MH090002B`;
- target order balance is `$10,453`;
- incorrect `Super DT2-08 B` is restored to `$0`, has no receipts or protected references, and is removed from `Un_Associated`;
- audit evidence records all before/after values.

If any precondition differs at repair time, the transaction aborts and the data is not guessed or partially changed.

## 9. Backup and Deployment Safety

This change modifies the database schema and repairs live business data, so the ordinary one-click rebuild is not sufficient by itself.

Before production migration or repair:

1. run and verify a fresh complete NAS snapshot of MySQL `trading_ledger` and `UPLOAD_HOST_DIR`;
2. restore that exact snapshot into an isolated MariaDB container without production ports, volumes, or networks;
3. apply the migration to the restored database;
4. verify protected table counts and representative fingerprints before and after migration;
5. run the incident-equivalent reversal against isolated test data;
6. record the restore/migration evidence under `docs/backup/restore-drills/`.

`docs/backup/muledger-local-backup.md` is updated to list the new balance-transfer linkage and this migration/repair gate. No command may drop, reset, truncate, or replace the production database or NAS upload directory.

## 10. Automated Verification

Automated tests must cover:

- transfer creation writes an explicit one-to-one Receipt link and correct balances;
- migration backfills the confirmed incident-equivalent pair and leaves ambiguous pairs unlinked;
- ADMIN can reverse a linked `Bank_Transfer` system Receipt immediately;
- SALES and USER cannot see or call reversal;
- ordinary `Bank_Transfer` Receipt deletion remains blocked;
- reversal deletes the transfer and synthetic Receipt, reverses source amount once, and recalculates both balances;
- repeated or concurrent reversal cannot double-decrement the source amount;
- formal source orders are retained;
- empty safe `Un_Associated` / `DEPOSIT_POOL` source orders are removed;
- referenced or non-empty pool orders are retained;
- an exact original-Receipt edit conflict returns confirmation-required without writing;
- confirmed ADMIN edit reverses the transfer and edits the Receipt in one transaction;
- stale, ambiguous, or incorrect confirmation performs no write;
- SALES approval uses the same ADMIN confirmation behavior;
- transaction failure rolls back transfer, Receipt, order amount, balances, cleanup, edit request status, and audit together;
- real Receipt and linked Payment Detail remain intact in the incident-equivalent case;
- Chinese and English success, error, and confirmation messages are correct;
- isolated API tests verify authorization and the incident-equivalent final state.

## 11. Delivery

- Work remains isolated from the running service until code and migration tests pass.
- Before PR creation and again before merge, synchronize the latest `main`.
- Update the single package version, user-facing README only where appropriate, engineering documentation, migration notes, and backup runbook.
- Push the branch, wait for every GitHub Actions job, and merge only when all required checks pass.
- After the verified backup and migration rehearsal, merge and run the project safe rebuild flow, apply the live repair once, then verify version, container health, logs, database invariants, NAS mount, authenticated API behavior, and public service availability.
