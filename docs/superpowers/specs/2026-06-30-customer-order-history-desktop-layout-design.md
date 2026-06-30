# Customer ORDER_NAME History Desktop Layout Design

## Scope

Only adjust the Customer Management ORDER_NAME history dialog's desktop layout. Preserve the existing mobile layout, typography, colors, borders, radii, headings, data content, and overall visual style.

## Desktop Dialog

- Size the dialog to its table content, capped at `calc(100vw - 32px)`.
- Keep Historical Orders and Recent Receipts side by side with their top edges aligned.
- Put horizontal overflow on the dialog's table-content region only.
- Show a horizontal scrollbar only when both tables exceed the available viewport width.
- Do not use JavaScript width measurement or narrow fixed column widths.

## Tables And Columns

- Use intrinsic table sizing instead of the current fixed table layout.
- Keep every row on one line except ORDER values containing `/`.
- Give ORDER a minimum width comparable to `BIG ALPHA-10A`.
- Insert optional line-break opportunities after `/`; do not break a single ORDER segment arbitrarily.
- Keep INV NO, AMOUNT, O/S, CREATED AT, RECEIPT, USD, and STATUS cells and headings on one line.
- Rename the Historical Orders heading `Outstanding` to `O/S`.

Historical Orders column order remains:

1. ORDER
2. INV NO
3. AMOUNT
4. O/S

Recent Receipts column order becomes:

1. CREATED AT
2. ORDER
3. USD
4. STATUS
5. RECEIPT

`CREATED AT` uses `Receipt.createdAt` and the same local-date presentation already used by Receipt Management. It does not use the receipt payment date.

## Data Contract

- Keep the existing database schema unchanged.
- Add `createdAt` to the customer ORDER_NAME history receipt response. The query already selects this field.
- Keep the existing receipt `date` field for compatibility.

## Verification

- Service test proves `createdAt` is returned independently from receipt payment date.
- Component test proves desktop intrinsic sizing, two-column top alignment, overflow containment, non-wrapping columns, `O/S`, Recent Receipts column order, and `/` break opportunities.
- Run the focused service and component tests, then lint, typecheck, build, and the relevant test suite.
