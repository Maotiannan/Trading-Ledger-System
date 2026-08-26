# Dashboard History Order and Pending Signed Receipt Draft Edit Design

Date: 2026-08-26

Status: Approved in conversation

## 1. Purpose

Fix two user-facing inconsistencies without changing financial matching rules or adding a database migration:

1. In the Dashboard customer detail dialog, show Recent Receipts before Historical Orders.
2. Let an unfinished generated signed-receipt draft be edited from Receipt Management and ensure resumed signing uses the edited draft.

## 2. Confirmed Business Rules

### 2.1 Dashboard customer detail order

- The existing Released and In Transit outstanding sections remain first and unchanged.
- Recent Receipts appears before Historical Orders in the shared Dashboard customer detail dialog.
- Both Dashboard entry points, Customer Outstanding Ranking and Customer Order & Payment History, keep opening the same dialog and therefore use the same order.
- Customer Management keeps its existing Historical Orders then Recent Receipts order.
- No data, pagination, styling, or visibility rule changes.

### 2.2 Pending signed-receipt draft edits

- A `SIGNING_PENDING` receipt is a draft and may be edited through the existing Receipt Management edit action.
- Existing authorization remains unchanged: ADMIN applies edits immediately; SALES submits the existing approval request and the edit applies only after ADMIN approval.
- Editable fields remain Receipt No., Payment Date, ORDER NO, INV NO, MARK, payer, and phone. This work does not add amount or receipt-template controls to the edit dialog.
- A pending draft edit must update both the Receipt and its pending receipt-generator session in one transaction.
- ORDER NO or INV NO changes reuse the existing receipt edit binding and matching rules.
- The pending session must refresh receipt number, date, ORDER NO, INV NO, customer/MARK, payer, phone, live balance context, motif, and generated layout.
- Amount, payment type, payment mode, fee status, and received-by selection remain unchanged because they are not fields in this edit flow.
- Resuming signing must display the updated draft. Finalization remains impossible until both signatures are provided.
- A finalized generated receipt is not treated as a pending session and continues through the existing normal receipt edit behavior.
- If a `SIGNING_PENDING` receipt has no valid pending generator session, the write fails clearly and atomically instead of leaving Receipt and signing data inconsistent.

## 3. Architecture

### 3.1 Dashboard-only section ordering

Add an optional layout property to `CustomerOrderHistoryContent`. Its default preserves the Customer Management order. `DashboardCustomerDetailDialog` opts into Recent Receipts first. Tests assert DOM order, not only text presence.

### 3.2 Shared pending-draft synchronization

Create one transaction-aware receipt-generator draft synchronization service. Both direct ADMIN updates and approved SALES requests call it after resolving the receipt binding and before committing the transaction.

The service loads the pending generator session, computes live balance through the shared order-balance service, preserves generator-only selections from the existing layout snapshot, rebuilds the layout through `buildReceiptGeneratorLayout`, and updates the denormalized session fields plus `layoutSnapshot` together.

The generator read service continues to normalize session data but honors the synchronized draft date and payer display so resuming signing shows exactly the saved draft.

## 4. Transactions, Errors, and Audit

- Receipt history, Receipt update, linked Detail Item update, and pending generator-session update are one database transaction.
- Any missing or invalid pending generator session rolls back the entire edit.
- Existing receipt edit and approval audit events remain the authoritative audit trail.
- Old and new order balance caches keep the existing recalculation behavior after a binding change.

## 5. Data and Backup Impact

- No table, column, migration, upload path, generated-file path, external storage, or cleanup rule changes.
- Existing MySQL and NAS backup scope remains sufficient; `docs/backup/muledger-local-backup.md` requires no scope update.
- Automated verification uses mocks and isolated API tests; no live receipt or signature record is modified during implementation.

## 6. Automated Verification

- Dashboard dialog renders Recent Receipts before Historical Orders.
- Customer Management retains Historical Orders before Recent Receipts.
- ADMIN can edit a `SIGNING_PENDING` draft and the generator session receives the rebuilt layout.
- SALES can request the edit; approval updates Receipt and generator session in the same transaction.
- A missing pending session rejects and rolls back the edit.
- Resume-session output returns edited receipt number, date, ORDER NO, INV NO, payer, phone, motif, and balance.
- Existing non-pending receipt edit, approval, signing finalization, and role visibility tests remain green.

## 7. Delivery

- Work occurs on an isolated branch without touching the running service.
- Before PR creation and merge, synchronize the latest `main`, run the full automated gates, update the single package version and user-facing README, and wait for GitHub Actions.
- After merge, deploy with `scripts/rebuild-local-app.sh` and verify containers, logs, public HTTP response, version, database connection, and NAS upload mount.
