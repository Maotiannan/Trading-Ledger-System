# Customer ORDER_NAME History Sorting And Pagination Design

## Goal

Improve the `ORDER_NAME History` dialog in Customer Management so historical orders and recent receipts have deterministic business sorting, independent server-side pagination, account-level page-size persistence, and compact mobile controls.

## Scope

This change affects only the two tables in the existing customer `ORDER_NAME History` dialog:

- `Historical Orders`
- `Recent Receipts`

It does not change customer ownership, customer visibility, ORDER_NAME matching, financial balances, or the established desktop table layout.

## Historical Orders Sorting

The service continues using the existing ORDER_NAME matching rules. Sorting and pagination happen only after the matching order rows have been identified.

Historical orders are divided into two top-level balance groups:

1. Orders with `O/S > 10`.
2. Orders with `O/S <= 10`, which always appear after every order in the first group.

Each balance group is then divided and sorted independently:

1. Orders whose invoice has neither `RELEASE DATE` nor `SHIP DATE` appear first. They are sorted by `O/S` from highest to lowest.
2. Orders whose invoice has a `RELEASE DATE` appear next. They are sorted by `RELEASE DATE` from newest to oldest.
3. Orders without a `RELEASE DATE` but with a `SHIP DATE` appear last. They are sorted by `SHIP DATE` from newest to oldest.

Stable tie breakers are:

1. Order creation time from newest to oldest.
2. Order ID in a deterministic order.

The invoice relation returned for sorting must include both `shipDate` and `releaseDate`. These fields are internal sorting inputs and do not add columns to the dialog.

## Recent Receipts Sorting

Recent receipts remain customer-level history, matching the existing dialog behavior.

- Sort by `Receipt.createdAt` from newest to oldest.
- Use receipt ID as a deterministic tie breaker.
- Remove the existing fixed limit of eight receipts.
- Keep displaying the existing `CREATED AT`, `ORDER`, `USD`, `STATUS`, and `RECEIPT` columns.

## API Contract

Extend the existing customer history request instead of creating duplicate endpoints:

`GET /api/customer?action=order-history`

The request accepts four independent pagination parameters:

- `orderPage`
- `orderPageSize`
- `receiptPage`
- `receiptPageSize`

Allowed page sizes for both tables are `5`, `10`, `15`, and `20`. The default is `10`.

The response keeps the existing `orders` and `receipts` arrays and adds independent pagination metadata for each list:

- current page
- page size
- total rows
- total pages

Invalid page sizes fall back to the account preference and then to `10`. Page numbers below one become one. Page numbers beyond the last available page are clamped to the last page.

Historical orders use the existing customer and ORDER_NAME access checks before filtering, sorting, and slicing the requested page. Recent receipts use database ordering and bounded `skip`/`take` pagination.

## Frontend State And Data Flow

The dialog maintains independent state for:

- historical order page
- historical order page size
- recent receipt page
- recent receipt page size

Behavior:

- Opening a different customer or ORDER_NAME resets both page numbers to one.
- Changing one table's page changes only that table's page state.
- Changing one table's page size resets only that table to page one.
- Existing rows remain visible while a pagination request is running.
- Pagination controls are temporarily disabled while the corresponding request is unresolved.
- Stale responses from an earlier customer, ORDER_NAME, or page request must not replace newer results.

## Account Preferences

Extend the existing JSON-backed list page-size preference with two independent keys:

- customer history orders
- customer history receipts

Both default to `10`.

The existing shared preference hook should accept per-consumer allowed options so these two lists can use `5/10/15/20` without adding `15` to Receipt, Payment Detail, or SWIFT pagination controls.

No Prisma migration is required because the settings remain inside the existing JSON preference field.

If preference persistence fails:

- keep the selected value for the current dialog session
- show a localized, human-readable warning
- do not block history data loading

## Responsive Pagination

Reuse the shared `ListPagination` component and add a parameterized compact presentation rather than creating a customer-only pagination component.

Compact mode must:

- keep page size, previous arrow, page summary, and next arrow on one line
- use the existing compact summary format, such as `1 / 2 (15)`
- occupy only a small footer row below each table
- fit a narrow mobile viewport without horizontal overflow
- preserve accessible labels for the select and arrow buttons

The existing desktop two-column dialog layout, table typography, colors, borders, and wrapping rules remain unchanged.

## Error Handling

- Empty results show the existing localized empty-state rows.
- Invalid or out-of-range pagination parameters are normalized by the server.
- API failures use the existing localized error presentation.
- A page-size preference failure is reported separately and does not erase loaded history.
- Loading a new page does not blank the entire dialog.

## Automated Verification

Service tests must cover:

- `O/S > 10` before `O/S <= 10`
- both dates empty, sorted by `O/S` descending
- release-dated rows sorted by `RELEASE DATE` descending
- ship-only rows sorted by `SHIP DATE` descending
- the same subgroup rules repeated within the `O/S <= 10` group
- stable tie breaking
- receipt ordering by `createdAt` descending
- independent page boundaries, totals, and page clamping

API tests must cover:

- both pagination parameter sets
- invalid page sizes
- invalid and out-of-range page numbers
- empty history

Component and preference tests must cover:

- both pagination controls rendering independently
- changing one page without resetting the other
- changing a page size resets only its own page
- account-level persistence of both page sizes
- compact controls staying in one row
- existing desktop table layout and column order remaining unchanged

Verification commands must include the relevant Jest tests, the complete test suite, lint or equivalent static checks, and a production build.

## Deployment Boundary

This feature does not add database tables, media paths, or migrations, so backup scope does not change.

After implementation and automated verification, do not rebuild the existing local Docker service automatically. Report the results and ask whether to run the project's safe local rebuild and push workflow.
