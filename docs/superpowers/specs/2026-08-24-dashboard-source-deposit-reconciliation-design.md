# Dashboard Customer Detail, MU Contract Source Recovery, and Deposit Pool Reconciliation Design

Date: 2026-08-24

Status: Approved in conversation; pending written-spec review

## 1. Purpose

Fix three related consistency defects without changing financial matching formulas or introducing a database migration:

1. Both Dashboard customer entry points open one complete customer detail dialog.
2. A recreated MU Contract PI can replace an inactive source link for the same ORDER NO.
3. Invoice creation, bulk import, and Rematch correctly move matching `DEPOSIT_POOL` orders into formal invoices.

## 2. Confirmed Business Rules

### 2.1 Unified Dashboard customer detail

- `Customer Outstanding Ranking` and `Customer Order & Payment History` must open the same dialog.
- The dialog first shows the existing Released and In Transit outstanding sections, including subtotals and Total Unpaid.
- The existing Historical Orders and Recent Receipts content appears below the outstanding sections.
- Both entry points use the same customer ID, visibility scope, live-balance calculation, pagination, and receipt-image preview behavior.
- A searched customer with no outstanding balance still opens the complete dialog and shows zero/empty outstanding sections above its history.
- Every ranking row should normally have a customer association. If an invalid unbound row exists, the dialog shows its existing outstanding data and a clear unavailable-history message. It must not guess a customer by a similar name.

### 2.2 Recreated MU Contract sources

- The hidden MU Contract PI ID remains the stable source identity.
- When a newly active PI has a different PI ID but the same normalized ORDER NO as an inactive old source, the new PI may take over the existing MULEDGER Orders row.
- The inactive source link remains in integration history but releases its live Orders-row association.
- The new source supplies its own PI creation time and official amount. An amount remains unknown until MU Contract supplies a successfully generated formal-PI amount.
- An active source link continues to block a second active source from silently taking over the same Orders row.
- Reprocessing the same PI ID remains idempotent.
- A later attempt to reactivate the displaced old PI must conflict while the replacement source is active; it cannot take the row back silently.

### 2.3 Moving system-pool orders into formal invoices

- `DEPOSIT_POOL` and `Un_Associated` are both system pools, not formal invoice destinations.
- During manual invoice creation or bulk invoice import, a matching system-pool Order is moved into the target INV NO inside the invoice-write transaction.
- The existing Order row is reused when no matching Order already exists in the target invoice. Its invoice association, formal amount, customer snapshot, tokens, and aliases are updated.
- Existing receipts remain linked to that Order, including deposit receipts and their `isDeposit` meaning.
- The formal invoice row amount replaces the system-pool placeholder amount; it is not added to it. This prevents a retried import from doubling an amount previously left in `DEPOSIT_POOL` by the defect.
- The order balance is recalculated from the shared balance service after persistence. Receipt values are never copied or counted twice.
- If the target invoice already contains the same Order, system-pool receipts are moved to the target Order and the redundant pool row is removed. The formal target amount remains authoritative and the pool amount is not added to it.

### 2.4 Historical repair through Rematch

- Rematch uses the same system-pool reconciliation service as invoice writing; it must not maintain a second migration formula.
- If a pool Order has exactly one matching Order in a formal invoice, Rematch automatically moves its receipts to that formal Order, removes the redundant pool row, and recalculates balance.
- If an affected `DEPOSIT_POOL` Order has a positive formal amount but no unique formal target, Rematch lists it for an administrator to choose the target INV NO.
- After explicit selection, the existing pool Order is moved to that invoice transactionally and its stored amount is retained.
- Pure deposit placeholders with zero amount are not offered for arbitrary manual placement. They move only when a unique matching formal Order exists or when a later invoice write supplies the authoritative formal amount.
- Similar names, customer groups, marks, and guessed invoice relationships must not choose a target INV NO.

## 3. Architecture

### 3.1 Dashboard composition

Extract the table and pagination body from `CustomerOrderHistoryDialog` into a reusable customer-history content component. Add one Dashboard customer-detail dialog that composes:

1. customer heading and Total Unpaid;
2. Released outstanding section;
3. In Transit outstanding section;
4. shared Historical Orders and Recent Receipts content.

Extend the existing Dashboard customer-history read path to return the selected customer's outstanding snapshot together with paginated history. The outstanding snapshot must use the same shared live-balance calculation as Dashboard summary. Pagination requests update only the history data and preserve the already-rendered dialog, avoiding a full-dialog loading reset.

Ranking clicks pass the customer ID and may show the already-loaded outstanding snapshot immediately while the history loads. Search-result clicks use the same customer ID and endpoint. The resulting rendered dialog is identical regardless of entry point.

### 3.2 External source takeover

Replace the current generic source-occupancy check with one helper that distinguishes:

- no foreign source: attach normally;
- inactive foreign source: detach the inactive link and attach the incoming active source in the same transaction;
- active foreign source: return the existing source-link collision.

The event receipt, source link update, conflict resolution, and audit evidence remain inside the existing integration transaction. The old source record is retained with a null live Orders-row association, so history is preserved without violating the one-live-source-per-row constraint.

### 3.3 System-pool reconciliation

Create one transaction-aware system-pool reconciliation module built on the existing shared system-pool constants and ORDER NO alias matcher. It exposes two narrowly scoped operations:

- reconcile one prepared invoice row into its known target invoice;
- inspect and apply historical Rematch candidates.

Invoice writing invokes the first operation before generic global-order merging. Manual creation and bulk import already converge on `saveInvoiceWithOrders`, so both paths receive the same fix.

Rematch invokes the second operation before its general duplicate cleanup. General duplicate cleanup must prefer non-system invoices over both `DEPOSIT_POOL` and `Un_Associated`; it must never select a system-pool row as the keeper when a formal row exists.

## 4. Transactions, Errors, and Audit

- Every invoice-row migration updates the Order, receipt links, aliases, and balance as one transaction.
- A failed migration leaves the pool Order and all receipts unchanged.
- Manual Rematch requires an existing visible formal target invoice and administrator authorization.
- A stale manual selection returns a readable conflict and performs no partial write.
- Invoice create/import success messages and Rematch summaries report how many system-pool Orders were moved.
- Structured audit metadata records source Order ID, source pool, target invoice ID/INV NO, target Order ID, moved receipt count, amount before/after, balance before/after, operation source (`INVOICE_WRITE`, `BULK_IMPORT`, `REMATCH_AUTO`, or `REMATCH_MANUAL`), and actor.
- MU Contract takeover audit evidence records old source PI ID, new source PI ID, Orders-row ID, normalized ORDER NO, and old/new official amount metadata.

## 5. API and UI Changes

- Keep the existing Dashboard search and history API surface where practical; extend its history response with the outstanding snapshot rather than making the browser combine unrelated summaries.
- Replace the two Dashboard customer dialogs with one state owner and one rendered dialog.
- Extend Rematch preview rows with a separate system-pool-repair section containing ORDER NO, current pool, amount, balance, receipt count, and unique target when available.
- Auto-repair candidates require no additional choice. Ambiguous historical candidates expose a target INV NO selector and cannot be applied until a visible formal invoice is selected.
- Existing conflict-group controls remain unchanged for unrelated duplicate-order work.

## 6. Data and Backup Impact

- No new database table, column, migration, media path, generated-file path, or external storage is introduced.
- Existing records are updated only through explicit invoice writes, integration events, or administrator Rematch application.
- The complete MySQL `trading_ledger` snapshot already covers all affected tables. `docs/backup/muledger-local-backup.md` needs no backup-scope change.
- Implementation verification must use isolated tests and must not run Rematch or invoice writes against the existing live data service.

## 7. Automated Verification

### Dashboard

- Ranking and search clicks open the same customer-detail dialog component.
- Both paths show Released, In Transit, Total Unpaid, Historical Orders, and Recent Receipts.
- Search customers with zero outstanding still show history.
- Unbound ranking data shows outstanding plus unavailable history and performs no guessed lookup.
- Role visibility and live-balance values remain identical to current shared services.
- Changing either history page does not blank or reconstruct the entire dialog.

### MU Contract source recovery

- A new active PI with the same normalized ORDER NO replaces an inactive foreign source link.
- The inactive source history remains stored and detached.
- The new PI creation time and official amount are displayed.
- Active-versus-active remains a conflict.
- Same-event and same-version retries are idempotent.
- A displaced old PI cannot silently reclaim the row while the replacement is active.

### Invoice and Rematch

- Manual creation moves a matching `DEPOSIT_POOL` Order into the target invoice.
- Bulk import uses the same behavior.
- `Un_Associated` follows the same reusable migration path.
- Receipts, deposit flags, aliases, customer association, and balance survive migration.
- Pool placeholder amounts are replaced, not added; retries do not double the amount.
- A target Order that already exists keeps its formal amount while receiving pool receipts.
- Rematch automatically repairs exactly one formal target.
- Ambiguous/no-target historical rows require explicit administrator selection.
- Zero-amount pure deposits cannot be arbitrarily assigned.
- Unauthorized or invisible target invoices are rejected.
- Transaction rollback, audit metadata, and idempotent rerun behavior are verified.

## 8. Delivery Boundaries

- Implementation occurs on an isolated branch/worktree after an approved implementation plan.
- No Docker rebuild or live-data repair is part of the code-edit phase.
- After automated tests and review pass, ask the user before rebuilding the local service, in accordance with project instructions.
