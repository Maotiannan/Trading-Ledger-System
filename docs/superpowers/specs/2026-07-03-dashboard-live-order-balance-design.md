# Dashboard Live Order Balance Design

## Goal

Make Dashboard outstanding balances trustworthy even when the persisted `Order.orderBalance` cache is stale. The system must compute balances on the server from source data, automatically repair stale cache values, and record the correction in logs/audit without asking administrators to manually fix balances.

## Root Cause

Dashboard currently trusts the persisted `Order.orderBalance` field. Historical signed receipts created before commit `983781b` did not always refresh that cache, so Dashboard could display stale balances until a later write path recalculated the order.

The correct balance rule already used by the matching domain is:

`ORDER BALANCE = Order.amount - sum(Receipt.usd for receipts linked to the order whose status is not SIGNING_PENDING)`

The problem is not the formula; the problem is that multiple pages and write paths use separate formulas or trust a cached value without verification.

## Required System Behavior

- Balance calculation happens only on the backend.
- Frontend components display API results and never calculate financial balances from raw rows.
- `Order.orderBalance` remains a persisted cache, but it is not a trusted final source for Dashboard totals.
- Dashboard summary queries read visible invoices, visible orders, and linked receipts in one structured query, avoiding per-order balance queries.
- Dashboard uses the computed live balance for:
  - `unpaidTotal`
  - Released Unpaid Invoices totals
  - Released Unpaid Invoices order rows
  - Customer Outstanding Ranking totals
  - Customer Outstanding Ranking modal rows and subtotals
- If stored cache and computed balance differ, the backend returns the computed balance and automatically writes the computed value back to `Order.orderBalance`.
- Automatic cache repair is logged and audited. No repair button or manual administrator workflow is added.
- If cache repair fails, Dashboard still returns computed balances and logs the repair failure. The user-facing number must not regress to the stale cache.

## Balance Kernel

Create a reusable backend module for order balance logic. The module owns the formula and precision behavior.

Responsibilities:

- Determine which receipt statuses count toward balance.
- Compute live order balance from `Order.amount` and receipt amounts/statuses.
- Compare stored and computed balances with money precision.
- Normalize results to numbers suitable for API responses.

The module must be pure where possible so tests can prove the `SUPER DT2-07` equivalent case:

- amount: `28674`
- receipts: `10000` and `15000`
- computed balance: `3674`

`SIGNING_PENDING` receipts do not reduce balance. `SR_Received`, `Waiting_SWIFT`, `Bank_Transfer`, and `RECEIVED` reduce balance.

## Balance Persistence Service

Add a small service around the pure kernel for database writes.

Responsibilities:

- Query an order with its linked receipts.
- Recompute the balance using the kernel.
- Update `Order.orderBalance` only when it differs from the computed value.
- Record a structured log entry for mismatches and repairs:
  - order ID
  - order number
  - stored balance
  - computed balance
  - difference
  - source
- Record an audit event for automatic repairs.
- Be safe to run more than once. Re-running after repair should make no additional data changes.

This is an automatic data-quality guard, not an administrator feature.

## Dashboard Data Flow

Dashboard `getDashboardSummary()` will select each visible order's linked receipts with status and USD amount. It will compute a balance context per order once and reuse that same computed value everywhere in the summary.

This prevents different Dashboard cards from using different formulas.

If a mismatch is detected during Dashboard generation:

1. The computed balance is used for every returned total and row.
2. An automatic repair is attempted after or during summary generation through the balance persistence service.
3. A structured log/audit record is written for engineering traceability.
4. No user-facing warning is shown on Dashboard.

## Existing Write Path Audit

Every path that creates, deletes, edits, or rebinds receipts, or changes order amount, must end by calling the unified balance service rather than duplicating the formula.

Audit targets include:

- normal receipt creation
- signed receipt finalize
- receipt edit/rebind approval
- receipt deletion approval
- Detail-created receipts
- invoice import/add/edit/merge
- balance transfer
- order alias maintenance helpers

Where a path already runs inside a transaction, the balance update should use the same transaction client. Where a legacy path updates cache after commit, migrate it into the transaction when practical. If moving it into the transaction is too risky for this batch, at minimum delegate to the unified service and document the remaining post-commit boundary.

## Tests

Add automated tests for:

- pure balance kernel formula, including the `28674 - 10000 - 15000 = 3674` case
- `SIGNING_PENDING` not counting toward received amount
- all active receipt statuses counting toward received amount
- stored/computed mismatch detection
- Dashboard using computed balance even when stored cache is wrong
- Dashboard unpaid total, customer subtotal, modal order rows, and released invoice totals all using the same computed value
- mismatch logging/audit repair call from Dashboard path
- signed receipt finalize still calling the unified balance update
- automatic repair idempotence
- visible-order isolation: Dashboard only scans/repairs orders returned by the current user's visibility filters

## Operational Notes

This design adds no new persistent table and no new uploaded media path. Backup scope does not change.

If implementation adds new audit action constants only, existing audit log backup already covers them through the existing MySQL dump.

Implementation should update engineering documentation with the balance source-of-truth rule so future agents do not reintroduce duplicate formulas.

## Relationship To Customer ORDER_NAME History Work

This balance fix is a separate, higher-priority batch. After it lands and passes automated tests, continue with the existing plan at:

`docs/superpowers/plans/2026-07-03-customer-order-history-pagination-sorting.md`
