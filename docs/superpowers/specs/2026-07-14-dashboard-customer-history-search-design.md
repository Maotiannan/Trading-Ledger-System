# Dashboard Customer History Search Design

**Date:** 2026-07-14

## Goal

Replace the Dashboard `Order Receipt Search` card with a customer history search that finds visible customers and opens the same history presentation used by Customer Management.

## Confirmed Search Rules

- Typing does not start a request. Search starts only from the Search button or Enter.
- `MARK` is an exact match after case and whitespace normalization.
- `ORDER_NAME` is an exact match after case and whitespace normalization, including every alias attached to the customer.
- A concrete `ORDER NO` uses the existing exact, alias, and `/` composite-order matching rules.
- `NAME` supports case-insensitive contains matching.
- Every matching customer is returned. Results are never merged across customers.
- Results are deduplicated by customer ID.
- Every logged-in role can use the card, but customer, order, and receipt rows are restricted to the current account's existing visibility scope.

## Search Result UI

- Keep the existing internal Dashboard card ID so saved card visibility and ordering remain valid.
- Rename the card to `客户历史订单/付款搜索 / Customer Order & Payment History`.
- Display only `MARK / ORDER NAME / NAME`.
- Render all three fields in blue and make each field open the same customer history dialog.
- Show all ORDER_NAME aliases together in the ORDER NAME cell.
- The result area shows approximately three customer rows; additional rows scroll vertically.
- Do not render pagination controls in the search result area.

## Customer History Dialog

- Clicking MARK, NAME, or any ORDER_NAME for the same customer opens identical content.
- Historical Orders include all visible financial orders attached to every ORDER_NAME of that customer.
- Recent Receipts include all visible receipts attached to that customer.
- Reuse the existing live order-balance formula and customer-history sorting rules.
- Keep the existing independent server pagination inside the history dialog.
- Keep existing desktop/mobile layout, column formatting, and loading behavior.

## Architecture

- Add a Dashboard-specific customer search API so Dashboard summary loading remains unchanged.
- Extract the shared customer-history read core so Customer Management and Dashboard do not maintain separate balance or sorting formulas.
- Keep Customer Management manager-only behavior unchanged.
- Dashboard history allows all roles but applies order and receipt visibility filters before returning rows.
- Preserve the existing Dashboard preference card ID while updating its user-facing labels.

## Data And Backup Impact

No database table, migration, media path, generated file, cleanup task, or external storage path changes. Existing MySQL and NAS/COS backup coverage is unchanged.

## Verification

- Service tests for every matching field, multiple matches, deduplication, composite ORDER NO, and role visibility.
- History tests for all ORDER_NAME aliases, live balances, sorting, receipt visibility, and independent pagination.
- Route tests for search/history actions and readable validation errors.
- Dashboard component tests for click-only search, Enter, three-row scrolling result area, blue clickable fields, no search-result pagination, and one identical dialog per customer.
- Isolated API regression for ADMIN and USER visibility boundaries.
