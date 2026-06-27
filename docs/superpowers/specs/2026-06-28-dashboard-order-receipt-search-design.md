# Dashboard ORDER NO Receipt Search Design

**Date:** 2026-06-28  
**Scope:** Add an account-scoped ORDER NO receipt search card to Dashboard and stabilize Dashboard pagination placement.

## Goal

Add a Dashboard card where a user enters an `ORDER NO`, explicitly starts a search, and sees the receipts associated with the order that the system actually resolves.

The feature must reuse the project's shared ORDER NO matching rules and receipt visibility rules. It must not introduce a second, Dashboard-only interpretation of order numbers or expose receipts outside the current account's visibility scope.

## Confirmed Behavior

1. The user enters any `ORDER NO` and clicks Search or presses Enter.
2. The server first runs the existing shared ORDER NO matching flow.
3. Existing normalization, exact matching, and `/` composite-order segment matching remain authoritative.
4. A segment match resolves to the complete stored ORDER NO before receipts are queried.
5. If no system order matches, the server returns a clear “matching order not found” result and does not search receipts using the raw input.
6. If an order matches but has no visible receipts, the card displays an empty-state message.
7. Search results contain only receipts visible to the signed-in account.
8. Results are sorted by payment date from newest to oldest. A missing payment date falls back to the receipt creation date. Rows with the same effective date use newest creation time first.
9. Results are paginated on the server with a fixed page size of 10.

## Dashboard Registration

Register a new card in the shared Dashboard registry:

- Card ID: `order-receipt-search`
- Chinese label: `订单收据查询`
- English label: `Order Receipt Search`
- Default section: `analysis`
- Default position: after the existing analysis cards
- Default visibility: visible

The card automatically participates in the existing account-level Dashboard settings. Users can show, hide, and reorder it without affecting other accounts.

The card does not have an inline remove icon. Visibility is controlled through Dashboard Settings, consistent with the current Dashboard behavior.

## API Design

Add a dedicated authenticated read endpoint:

```text
GET /api/dashboard/receipt-search?orderNo=<value>&page=<number>
```

The page size is fixed at 10 and is not accepted from the browser.

Successful response shape:

```json
{
  "matchedOrderNo": "PIKIN-19_B/PIKIN-19B/PIKIN-21",
  "items": [
    {
      "id": "receipt-id",
      "orderNo": "PIKIN-19_B/PIKIN-19B/PIKIN-21",
      "date": "2026-06-28",
      "amount": 2500,
      "status": "RECEIVED"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalItems": 1,
    "totalPages": 1
  }
}
```

The endpoint owns the complete read flow:

1. Authenticate the current account.
2. Validate and normalize the query.
3. Resolve the entered value through the shared ORDER NO matcher.
4. Build the current account's receipt visibility scope.
5. Query only receipts associated with the resolved order.
6. Apply date ordering and database pagination.
7. Return a small Dashboard-specific response.

The Dashboard summary endpoint remains unchanged so this search cannot slow initial Dashboard loading.

## User Interface

The card contains:

1. An `ORDER NO` input.
2. A Search button.
3. A matched-order summary after a successful lookup.
4. A four-column result table:
   - `ORDER NO`
   - `Date`
   - `Amount`
   - `Status`
5. A pagination bar containing Previous, current page, and Next.

Additional behavior:

- Search runs only on Search click or Enter, not on every keystroke.
- Starting a new search resets the page to 1.
- Changing pages repeats the last confirmed search without reinterpreting unfinished input.
- Search and pagination controls are disabled while their request is running.
- Amount uses the existing whole-dollar international formatting.
- Receipt status uses the existing Chinese/English display mapping.
- API errors use the project's human-readable bilingual error handling.
- The mobile layout keeps the input, button, table, and pagination within the card width.

## Stable Pagination Placement

The following Dashboard cards must keep their pagination controls at the bottom of the card even when the current page contains fewer than 10 rows:

- Released Unpaid Invoices
- Customer Outstanding Ranking
- Order Receipt Search

Each card uses a full-height vertical layout. The result area occupies the available middle space and reserves the height expected for a 10-row page; the pagination bar is the final card element. This is card-bottom placement, not a sticky bar attached to the browser viewport.

The responsive implementation must avoid a desktop-only fixed width or height that causes mobile overflow.

## Error And Empty States

- Empty input: prompt the user to enter an ORDER NO.
- No matching order: state that no matching order was found; do not query raw receipt text.
- Matched order with no receipts: state that the order has no receipt records.
- Unauthorized data: exclude it at query time rather than filtering it in the browser.
- Request failure: retain the confirmed search value and allow retry.
- Page becomes invalid after data changes: normalize to the last available page or page 1.

## Testing

### Service And API Tests

- Exact ORDER NO match.
- Existing normalization behavior, including ignored spaces where supported by the shared matcher.
- `/` composite-order segment resolves to the complete stored ORDER NO.
- No-match response does not run a raw receipt search.
- Receipt visibility is limited to the current account scope.
- Results include all visible receipt statuses.
- Payment-date ordering and creation-date fallback.
- Stable secondary ordering by creation time.
- Fixed 10-row pagination and page metadata.
- Empty and invalid query handling.

### Frontend Tests

- Search button starts the query.
- Enter starts the same query.
- New search resets to page 1.
- Pagination reuses the confirmed matched search.
- Loading, no-match, empty, error, and success states.
- Amount and status display use shared formatters.
- The new card is appended by Dashboard preference normalization and appears in Dashboard Settings.
- The three paginated Dashboard cards render pagination in their bottom layout area.

## Data And Backup Impact

This feature adds no database table, migration, media file, generated file, upload directory, external storage path, or cleanup task. Existing MySQL and NAS/COS backup coverage is unchanged.

## Delivery Scope

Implementation must keep these artifacts synchronized:

- shared ORDER NO matching and receipt visibility reuse
- dedicated API and automated tests
- Dashboard UI, bilingual text, and responsive layout
- Dashboard registry and settings behavior
- version source
- concise README user-facing update
- engineering log and task tracking
- Git commit, remote push, and GitHub Actions verification

Local Docker rebuild is performed only after implementation verification, using the project's safe rebuild script and without modifying database volumes or NAS data.
